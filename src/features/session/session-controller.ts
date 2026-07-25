import type {
  CapturedRequest,
  RecordingSession,
  RetentionMode,
  SessionWarning,
} from '../../domain/model';
import { addBounded, freezeSession } from '../../domain/ring-buffer';
import type { SessionRepository } from '../../ports/session-repository';
import { reduceSession } from './session-reducer';

export interface SessionLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SessionController {
  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  setRetention(retention: RetentionMode): Promise<void>;
  accept(request: CapturedRequest): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RecordingSession;
}

export type SessionControllerDependencies = Readonly<{
  initialSession: RecordingSession;
  repositories: Readonly<Record<RetentionMode, SessionRepository>>;
  lifecycle?: SessionLifecycle;
  clock?: () => number;
}>;

const noopLifecycle: SessionLifecycle = {
  async start() {},
  async stop() {},
};

function persistenceWarning(error: unknown): SessionWarning {
  return {
    code: 'persistence-disabled',
    message:
      error instanceof Error
        ? `Local persistence was disabled: ${error.message}`
        : 'Local persistence was disabled after an unknown storage failure.',
  };
}

function migrationWarning(error: unknown): SessionWarning {
  return {
    code: 'migration-failed',
    message:
      error instanceof Error
        ? `Retention migration failed: ${error.message}`
        : 'Retention migration failed; the previous mode remains active.',
  };
}

function migrationCleanupWarning(
  migrationError: unknown,
  cleanupError: unknown,
): SessionWarning {
  const migrationMessage =
    migrationError instanceof Error ? migrationError.message : 'unknown failure';
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup failure';
  return {
    code: 'migration-cleanup-failed',
    message: `Retention migration failed (${migrationMessage}); cleanup also failed (${cleanupMessage}). Residual target evidence will be removed by Clear.`,
  };
}

function captureWarning(error: unknown): SessionWarning {
  return {
    code: 'capture-failed',
    message:
      error instanceof Error
        ? `Capture lifecycle failed: ${error.message}`
        : 'Capture lifecycle failed.',
  };
}

export function createSessionController(
  dependencies: SessionControllerDependencies,
): SessionController {
  const lifecycle = dependencies.lifecycle ?? noopLifecycle;
  const clock = dependencies.clock ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot = freezeSession(dependencies.initialSession);
  let persistenceEnabled = true;
  let startInFlight: Promise<void> | null = null;
  let stopInFlight: Promise<void> | null = null;
  let clearInFlight: Promise<void> | null = null;
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

  function replace(next: RecordingSession): void {
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
    } catch (error) {
      persistenceEnabled = false;
      warn(persistenceWarning(error));
    }
  }

  function queueOperation(task: () => Promise<void>): Promise<void> {
    const ticket = ++operationSequence;
    let result: Promise<void>;
    if (operationBusy) {
      result = operationTail.then(task);
    } else {
      operationBusy = true;
      result = task();
    }
    operationTail = result.catch(() => undefined);
    void operationTail.then(() => {
      if (ticket === operationSequence) {
        operationBusy = false;
      }
    });
    return result;
  }

  async function performStart(): Promise<void> {
    if (snapshot.phase === 'recording') {
      return;
    }
    replace(reduceSession(snapshot, { type: 'phase', phase: 'starting', at: clock() }));
    try {
      await lifecycle.start();
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'recording',
          at: clock(),
        }),
      );
      await persistPhaseSnapshot();
    } catch (error) {
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'stopped',
          at: clock(),
        }),
      );
      warn(captureWarning(error));
      throw error;
    }
  }

  async function performStop(persist = true): Promise<void> {
    if (snapshot.phase === 'stopped') {
      return;
    }
    replace(reduceSession(snapshot, { type: 'phase', phase: 'stopping', at: clock() }));
    try {
      await lifecycle.stop();
    } catch (error) {
      warn(captureWarning(error));
      throw error;
    } finally {
      replace(
        reduceSession(snapshot, {
          type: 'phase',
          phase: 'stopped',
          at: clock(),
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
      if (startInFlight !== null) {
        return startInFlight;
      }

      const operation = queueOperation(performStart);
      const tracked = operation.finally(() => {
        startInFlight = null;
      });
      startInFlight = tracked;
      return startInFlight;
    },

    stop(): Promise<void> {
      if (snapshot.phase === 'stopped' && !operationBusy) {
        return Promise.resolve();
      }
      if (stopInFlight !== null) {
        return stopInFlight;
      }

      const operation = queueOperation(performStop);
      const tracked = operation.finally(() => {
        stopInFlight = null;
      });
      stopInFlight = tracked;
      return stopInFlight;
    },

    clear(): Promise<void> {
      if (clearInFlight !== null) {
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
          } catch (error) {
            clearErrors.push(error);
          }
        }
        replace(reduceSession(snapshot, { type: 'clear', at: clock() }));
        if (clearErrors.length === 0) {
          persistenceEnabled = true;
        } else {
          persistenceEnabled = false;
          warn(persistenceWarning(clearErrors[0]));
        }
      });
      const tracked = operation.finally(() => {
        clearInFlight = null;
      });
      clearInFlight = tracked;
      return clearInFlight;
    },

    setRetention(retention): Promise<void> {
      return queueOperation(async () => {
        if (retention === snapshot.retention) {
          return;
        }
        const previousRetention = snapshot.retention;
        const previous = dependencies.repositories[previousRetention];
        const target = dependencies.repositories[retention];
        const migrated = reduceSession(snapshot, { type: 'retention', retention });
        if (target === previous) {
          try {
            await target.save(migrated);
          } catch (error) {
            warn(migrationWarning(error));
            return;
          }
          persistenceEnabled = true;
          replace(migrated);
          return;
        }
        try {
          await target.save(migrated);
          await previous.clear(snapshot.id);
        } catch (error) {
          try {
            await target.clear(snapshot.id);
          } catch (cleanupError) {
            warn(migrationCleanupWarning(error, cleanupError));
            return;
          }
          warn(migrationWarning(error));
          return;
        }
        persistenceEnabled = true;
        replace(migrated);
      });
    },

    async accept(request): Promise<void> {
      let repository: SessionRepository | null = null;
      let retention: RetentionMode | null = null;
      let persistence: Promise<void> | null = null;
      await queueOperation(async () => {
        replace(addBounded(snapshot, request));
        if (persistenceEnabled) {
          repository = activeRepository();
          retention = snapshot.retention;
          persistence = repository.save(snapshot);
        }
      });
      if (persistence === null) {
        return;
      }
      try {
        await persistence;
      } catch (error) {
        await queueOperation(async () => {
          if (retention === snapshot.retention && repository === activeRepository()) {
            persistenceEnabled = false;
            warn(persistenceWarning(error));
          }
        });
      }
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): RecordingSession {
      return snapshot;
    },
  };

  return controller;
}
