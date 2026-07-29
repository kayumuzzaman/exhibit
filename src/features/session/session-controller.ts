import type { RetentionMode, SessionWarning } from '../../domain/model';
import type {
  SanitizedCapturedRequest,
  SanitizedInteractionEvent,
  SanitizedRecordingSession,
} from '../../domain/sanitized';
import { addBounded, freezeSession } from '../../domain/ring-buffer';
import type { CaptureIssue } from '../../ports/capture-source';
import type { SessionRepository } from '../../ports/session-repository';
import { reduceSession } from './session-reducer';

export interface SessionLifecycle {
  start(startedAt: number): Promise<void>;
  stop(stoppedAt: number): Promise<void>;
}

export interface SessionController {
  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  setRetention(retention: RetentionMode): Promise<void>;
  accept(request: SanitizedCapturedRequest): Promise<void>;
  acceptInteraction(interaction: SanitizedInteractionEvent): void;
  warn(issue: CaptureIssue): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): SanitizedRecordingSession;
}

export type SessionControllerDependencies = Readonly<{
  initialSession: SanitizedRecordingSession;
  repositories: Readonly<Record<RetentionMode, SessionRepository>>;
  lifecycle?: SessionLifecycle;
  clock?: () => number;
}>;

const noopLifecycle: SessionLifecycle = {
  async start() {},
  async stop() {},
};

function persistenceWarning(): SessionWarning {
  return {
    code: 'persistence-disabled',
    message: 'Local persistence was disabled after a storage failure.',
  };
}

function migrationWarning(): SessionWarning {
  return {
    code: 'migration-failed',
    message: 'Retention migration failed; the previous mode remains active.',
  };
}

function migrationCleanupWarning(): SessionWarning {
  return {
    code: 'migration-cleanup-failed',
    message:
      'Retention migration and cleanup failed. Clear removes residual local evidence.',
  };
}

function captureWarning(): SessionWarning {
  return {
    code: 'capture-failed',
    message: 'Capture lifecycle failed.',
  };
}

const CAPTURE_ISSUE_MESSAGES: Readonly<Record<CaptureIssue['code'], string>> =
  Object.freeze({
    'classification-failed': 'Request classification was unavailable.',
    'content-api-unavailable':
      'Response content was unavailable from the DevTools API.',
    'content-callback-timeout': 'Response content retrieval timed out.',
    'explanation-failed': 'Request explanation was unavailable.',
    'har-api-unavailable': 'The DevTools HAR snapshot was unavailable.',
    'har-callback-timeout': 'The DevTools HAR snapshot timed out.',
    'invalid-content-encoding':
      'Response content used an unsupported DevTools encoding.',
    'invalid-har': 'The DevTools HAR snapshot was malformed.',
    'invalid-started-time':
      'A network entry was skipped because its start time was invalid.',
    'interaction-start-failed':
      'Interaction capture was unavailable; network capture continued.',
    'normalization-failed':
      'A captured request could not be normalized and was skipped.',
    'redaction-failed': 'A captured request failed closed during redaction.',
    'sink-failed': 'A sanitized request could not be added to the session.',
  });

export function createSessionController(
  dependencies: SessionControllerDependencies,
): SessionController {
  const lifecycle = dependencies.lifecycle ?? noopLifecycle;
  const clock = dependencies.clock ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot = freezeSession(dependencies.initialSession);
  let recoveryLocked = snapshot.warnings.some(({ code }) => code === 'corrupt-session');
  let persistenceEnabled = !recoveryLocked;
  let startInFlight: Promise<void> | null = null;
  let stopInFlight: Promise<void> | null = null;
  let clearInFlight: Promise<void> | null = null;
  let startTicket = 0;
  let stopTicket = 0;
  let clearTicket = 0;
  let operationTail = Promise.resolve();
  let operationBusy = false;
  let operationSequence = 0;

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A view listener must never break capture or other observers.
      }
    }
  }

  function replace(next: SanitizedRecordingSession): void {
    if (next !== snapshot) {
      snapshot = next;
      notify();
    }
  }

  function warn(warning: SessionWarning): void {
    replace(reduceSession(snapshot, { type: 'warning', warning }));
  }

  function activeRepository(): SessionRepository {
    return dependencies.repositories[snapshot.retention];
  }

  async function persistPhaseSnapshot(): Promise<void> {
    if (!persistenceEnabled) {
      return;
    }
    try {
      await activeRepository().save(snapshot);
    } catch {
      persistenceEnabled = false;
      warn(persistenceWarning());
    }
  }

  function queueOperation<T = void>(task: () => Promise<T>): Promise<T> {
    const ticket = ++operationSequence;
    let result: Promise<T>;
    if (operationBusy) {
      result = operationTail.then(task);
    } else {
      operationBusy = true;
      result = task();
    }
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    void operationTail.then(() => {
      if (ticket === operationSequence) {
        operationBusy = false;
      }
    });
    return result;
  }

  /**
   * A repeated start, stop, or clear may reuse the in-flight promise only while
   * that operation is still the newest queued intent. Once an opposing
   * operation has been queued behind it, reusing the promise would drop the
   * newer request and resolve the caller against a phase it never asked for.
   */
  function isNewestIntent(ticket: number): boolean {
    return ticket === operationSequence;
  }

  async function performStart(): Promise<void> {
    if (snapshot.phase === 'recording') {
      return;
    }
    const startedAt = clock();
    replace(
      reduceSession(snapshot, { type: 'phase', phase: 'starting', at: startedAt }),
    );
    try {
      await lifecycle.start(startedAt);
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'recording',
          at: startedAt,
        }),
      );
      await persistPhaseSnapshot();
    } catch (error) {
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'stopped',
          at: startedAt,
        }),
      );
      warn(captureWarning());
      throw error;
    }
  }

  async function performStop(persist = true): Promise<void> {
    if (snapshot.phase === 'stopped') {
      return;
    }
    const stoppedAt = clock();
    replace(
      reduceSession(snapshot, { type: 'phase', phase: 'stopping', at: stoppedAt }),
    );
    try {
      await lifecycle.stop(stoppedAt);
    } catch (error) {
      warn(captureWarning());
      throw error;
    } finally {
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'stopped',
          at: stoppedAt,
        }),
      );
    }
    if (persist) {
      await persistPhaseSnapshot();
    }
  }

  const controller: SessionController = {
    start(): Promise<void> {
      if (snapshot.phase === 'recording' && !operationBusy) {
        return Promise.resolve();
      }
      if (startInFlight !== null && isNewestIntent(startTicket)) {
        return startInFlight;
      }

      const operation = queueOperation(performStart);
      startTicket = operationSequence;
      const tracked: Promise<void> = operation.finally(() => {
        if (startInFlight === tracked) {
          startInFlight = null;
        }
      });
      startInFlight = tracked;
      return startInFlight;
    },

    stop(): Promise<void> {
      if (snapshot.phase === 'stopped' && !operationBusy) {
        return Promise.resolve();
      }
      if (stopInFlight !== null && isNewestIntent(stopTicket)) {
        return stopInFlight;
      }

      const operation = queueOperation(performStop);
      stopTicket = operationSequence;
      const tracked: Promise<void> = operation.finally(() => {
        if (stopInFlight === tracked) {
          stopInFlight = null;
        }
      });
      stopInFlight = tracked;
      return stopInFlight;
    },

    clear(): Promise<void> {
      if (clearInFlight !== null && isNewestIntent(clearTicket)) {
        return clearInFlight;
      }
      const operation = queueOperation(async () => {
        await performStop(false).catch(() => undefined);
        const repositories = [
          activeRepository(),
          ...Object.values(dependencies.repositories),
        ].filter((repository, index, values) => values.indexOf(repository) === index);
        const clearErrors: unknown[] = [];
        for (const repository of repositories) {
          try {
            await repository.clear(snapshot.id);
            await repository.clearCurrent?.(snapshot.tabId);
          } catch (error) {
            clearErrors.push(error);
          }
        }
        replace(reduceSession(snapshot, { type: 'clear', at: clock() }));
        if (clearErrors.length === 0) {
          recoveryLocked = false;
          persistenceEnabled = true;
        } else {
          persistenceEnabled = false;
          warn(persistenceWarning());
        }
      });
      clearTicket = operationSequence;
      const tracked: Promise<void> = operation.finally(() => {
        if (clearInFlight === tracked) {
          clearInFlight = null;
        }
      });
      clearInFlight = tracked;
      return clearInFlight;
    },

    setRetention(retention): Promise<void> {
      return queueOperation(async () => {
        if (retention === snapshot.retention) {
          return;
        }
        if (recoveryLocked) {
          warn(migrationWarning());
          return;
        }
        const previousRetention = snapshot.retention;
        const previous = dependencies.repositories[previousRetention];
        const target = dependencies.repositories[retention];
        const migrated = reduceSession(snapshot, { type: 'retention', retention });
        // `commit` re-reduces from the live snapshot rather than replaying the
        // copy that was written. Interactions arrive outside the operation
        // queue, so anything appended while the migration write was in flight
        // would be discarded by replacing with the pre-write copy.
        const commit = (): void => {
          persistenceEnabled = true;
          replace(reduceSession(snapshot, { type: 'retention', retention }));
        };
        if (target === previous) {
          try {
            await target.save(migrated);
          } catch {
            warn(migrationWarning());
            return;
          }
          commit();
          return;
        }
        try {
          await target.save(migrated);
          await previous.clear(snapshot.id);
        } catch {
          try {
            await target.clear(snapshot.id);
          } catch {
            warn(migrationCleanupWarning());
            return;
          }
          warn(migrationWarning());
          return;
        }
        commit();
      });
    },

    async accept(request): Promise<void> {
      type ScheduledWrite = Readonly<{
        repository: SessionRepository;
        retention: RetentionMode;
        persistence: Promise<void>;
      }>;
      const scheduled = await queueOperation<ScheduledWrite | null>(async () => {
        replace(addBounded(snapshot, request));
        if (!persistenceEnabled) {
          return null;
        }
        const repository = activeRepository();
        return {
          repository,
          retention: snapshot.retention,
          persistence: repository.save(snapshot),
        };
      });
      if (scheduled === null) {
        return;
      }
      const { repository, retention, persistence } = scheduled;
      // Repository writes are debounced, so awaiting one here would stall the
      // serial capture queue for a whole debounce window on every request and
      // cap capture throughput at the debounce rate. The write is still
      // tracked: a failure disables persistence and raises the same warning,
      // just a turn later than the request that carried it.
      void persistence.catch(() => {
        void queueOperation(async () => {
          if (retention === snapshot.retention && repository === activeRepository()) {
            persistenceEnabled = false;
            warn(persistenceWarning());
          }
        });
      });
    },

    acceptInteraction(interaction): void {
      replace(reduceSession(snapshot, { type: 'interaction', interaction }));
    },

    warn(issue): void {
      warn({
        code: issue.code,
        message: CAPTURE_ISSUE_MESSAGES[issue.code],
      });
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): SanitizedRecordingSession {
      return snapshot;
    },
  };

  return controller;
}
