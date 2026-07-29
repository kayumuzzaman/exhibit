import type { SanitizedRecordingSession } from '../../domain/sanitized';
import type { SessionRepository } from '../../ports/session-repository';
import {
  createCorruptSession,
  decodeSessionLocator,
  decodeStoredSession,
  encodeSessionLocator,
  encodeStoredSession,
  recoverSessionIdFromLocator,
} from './schema';

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

type Waiter = Readonly<{
  resolve: () => void;
  reject: (reason: unknown) => void;
}>;

type PendingWrite = {
  session: SanitizedRecordingSession;
  sessionId: string;
  tabId: string;
  sequence: number;
  waiters: Waiter[];
};

export type SessionStorageRepositoryOptions = Readonly<{
  debounceMs?: number;
  keyPrefix?: string;
  currentKeyPrefix?: string;
}>;

export function createSessionStorageRepository(
  area: StorageArea,
  options: SessionStorageRepositoryOptions = {},
): SessionRepository {
  const debounceMs = options.debounceMs ?? 100;
  const keyPrefix = options.keyPrefix ?? 'exhibit:session:';
  const currentKeyPrefix = options.currentKeyPrefix ?? 'exhibit:current:';
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError('debounceMs must be a finite non-negative number.');
  }

  const pending = new Map<string, PendingWrite>();
  const knownTabs = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let operation = Promise.resolve();
  let saveSequence = 0;

  function keyFor(sessionId: string): string {
    return `${keyPrefix}${sessionId}`;
  }

  function currentKeyFor(tabId: string): string {
    return `${currentKeyPrefix}${tabId}`;
  }

  function queueOperation<T>(task: () => Promise<T>): Promise<T> {
    const result = operation.then(task, task);
    operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function settle(
    writes: readonly PendingWrite[],
    result: Promise<void>,
  ): Promise<void> {
    void result.then(
      () => {
        for (const write of writes) {
          for (const waiter of write.waiters) {
            waiter.resolve();
          }
        }
      },
      (reason: unknown) => {
        for (const write of writes) {
          for (const waiter of write.waiters) {
            waiter.reject(reason);
          }
        }
      },
    );
    return result;
  }

  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) {
      return operation;
    }

    const captured = [...pending.entries()];
    pending.clear();
    const items: Record<string, unknown> = {};
    const current = new Map<string, PendingWrite>();
    const writes: PendingWrite[] = [];
    let encodingError: unknown;
    for (const [key, write] of captured) {
      // Encoding is deferred to the flush so a burst of saves for one session
      // encodes once instead of once per call. Encoding walks and clones the
      // whole ring buffer, so per-call encoding is quadratic against a session
      // that grows toward the byte ceiling.
      let stored: unknown;
      try {
        stored = encodeStoredSession(write.session);
      } catch (error) {
        encodingError ??= error;
        for (const waiter of write.waiters) {
          waiter.reject(error);
        }
        continue;
      }
      items[key] = stored;
      writes.push(write);
      const latest = current.get(write.tabId);
      if (latest === undefined || write.sequence > latest.sequence) {
        current.set(write.tabId, write);
      }
    }
    if (writes.length === 0) {
      return operation.then(() => {
        if (encodingError !== undefined) throw encodingError;
      });
    }
    for (const write of current.values()) {
      items[currentKeyFor(write.tabId)] = encodeSessionLocator({
        id: write.sessionId,
        tabId: write.tabId,
      });
    }
    const persistence = settle(
      writes,
      queueOperation(async () => {
        await area.set(items);
      }),
    );
    if (encodingError === undefined) return persistence;
    return persistence.then(() => {
      throw encodingError;
    });
  }

  return {
    async load(sessionId): Promise<SanitizedRecordingSession | null> {
      await flush().catch(() => undefined);
      const key = keyFor(sessionId);
      return queueOperation(async () => {
        const values = await area.get(key);
        if (!(key in values)) {
          return null;
        }
        const session = decodeStoredSession(values[key], sessionId);
        if (session.tabId !== '') {
          knownTabs.set(session.id, session.tabId);
        }
        return session;
      });
    },

    async loadCurrent(tabId): Promise<SanitizedRecordingSession | null> {
      await flush().catch(() => undefined);
      return queueOperation(async () => {
        const locatorKey = currentKeyFor(tabId);
        const locatorValues = await area.get(locatorKey);
        if (!(locatorKey in locatorValues)) {
          return null;
        }
        const locator = decodeSessionLocator(locatorValues[locatorKey], tabId);
        if (locator === null) {
          const recoveredId =
            recoverSessionIdFromLocator(locatorValues[locatorKey]) ??
            `corrupt-current:${tabId}`;
          knownTabs.set(recoveredId, tabId);
          return createCorruptSession(recoveredId, tabId);
        }
        const sessionKey = keyFor(locator.sessionId);
        const sessionValues = await area.get(sessionKey);
        if (!(sessionKey in sessionValues)) {
          knownTabs.set(locator.sessionId, tabId);
          return createCorruptSession(locator.sessionId, tabId);
        }
        knownTabs.set(locator.sessionId, tabId);
        return decodeStoredSession(sessionValues[sessionKey], locator.sessionId, tabId);
      });
    },

    save(session): Promise<void> {
      const key = keyFor(session.id);
      knownTabs.set(session.id, session.tabId);
      return new Promise<void>((resolve, reject) => {
        const current = pending.get(key);
        if (current === undefined) {
          pending.set(key, {
            session,
            sessionId: session.id,
            tabId: session.tabId,
            sequence: ++saveSequence,
            waiters: [{ resolve, reject }],
          });
        } else {
          current.session = session;
          current.tabId = session.tabId;
          current.sequence = ++saveSequence;
          current.waiters.push({ resolve, reject });
        }
        if (timer === null) {
          timer = setTimeout(() => {
            void flush().catch(() => undefined);
          }, debounceMs);
        }
      });
    },

    flush(): Promise<void> {
      return flush();
    },

    async clear(sessionId): Promise<void> {
      const key = keyFor(sessionId);
      const canceled = pending.get(key);
      pending.delete(key);
      if (pending.size === 0 && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const result = queueOperation(async () => {
        const tabId = canceled?.tabId ?? knownTabs.get(sessionId);
        if (tabId === undefined) {
          await area.remove(key);
          return;
        }
        const locatorKey = currentKeyFor(tabId);
        const values = await area.get(locatorKey);
        const locator = decodeSessionLocator(values[locatorKey], tabId);
        await area.remove(locator?.sessionId === sessionId ? [key, locatorKey] : key);
        knownTabs.delete(sessionId);
      });
      if (canceled !== undefined) {
        settle([canceled], result);
      }
      await result;
    },

    async clearCurrent(tabId): Promise<void> {
      await flush().catch(() => undefined);
      await queueOperation(async () => {
        const locatorKey = currentKeyFor(tabId);
        const values = await area.get(locatorKey);
        if (!(locatorKey in values)) return;
        const sessionId = recoverSessionIdFromLocator(values[locatorKey]);
        if (sessionId === null) {
          await area.remove(locatorKey);
          return;
        }
        pending.delete(keyFor(sessionId));
        knownTabs.delete(sessionId);
        await area.remove([keyFor(sessionId), locatorKey]);
      });
    },
  };
}
