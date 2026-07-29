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

export const PAYLOADRA_DATABASE = 'payloadra';
export const PAYLOADRA_DATABASE_VERSION = 1;
export const SESSION_STORE = 'sessions';
export const SETTINGS_STORE = 'settings';

export function openPayloadraDatabase(
  factory: IDBFactory,
  databaseName = PAYLOADRA_DATABASE,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, PAYLOADRA_DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        database.createObjectStore(SESSION_STORE);
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(request.error);
      }
    };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB upgrade was blocked.'));
      }
    };
  });
}

function execute<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(SESSION_STORE, mode);
    const request = createRequest(transaction.objectStore(SESSION_STORE));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

type Waiter = Readonly<{
  resolve: () => void;
  reject: (reason: unknown) => void;
}>;

type PendingWrite = {
  sessionId: string;
  session: SanitizedRecordingSession;
  waiters: Waiter[];
};

export type IndexedDbSessionRepositoryOptions = Readonly<{
  databaseName?: string;
  debounceMs?: number;
}>;

export function createIndexedDbSessionRepository(
  factory: IDBFactory,
  options: IndexedDbSessionRepositoryOptions = {},
): SessionRepository {
  const databaseName = options.databaseName ?? PAYLOADRA_DATABASE;
  const debounceMs = options.debounceMs ?? 100;
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError('debounceMs must be a finite non-negative number.');
  }
  const database = openPayloadraDatabase(factory, databaseName);
  const knownTabs = new Map<string, string>();
  /**
   * Every accepted request asks the controller to persist the whole session, so
   * writing straight through would re-encode and re-store the entire ring
   * buffer once per request — quadratic work against a session that grows to
   * the byte ceiling. Writes are coalesced per session id; the newest snapshot
   * wins and every caller waiting on that session settles on its result.
   */
  const pending = new Map<string, PendingWrite>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let operation: Promise<unknown> = Promise.resolve();

  function currentKey(tabId: string): string {
    return `current:${tabId}`;
  }

  function queueOperation<T>(task: () => Promise<T>): Promise<T> {
    const result = operation.then(task, task);
    operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function settle(write: PendingWrite, result: Promise<void>): void {
    void result.then(
      () => {
        for (const waiter of write.waiters) {
          waiter.resolve();
        }
      },
      (reason: unknown) => {
        for (const waiter of write.waiters) {
          waiter.reject(reason);
        }
      },
    );
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) {
      await operation;
      return;
    }
    const captured = [...pending.values()];
    pending.clear();
    const results: Promise<void>[] = [];
    for (const write of captured) {
      const result = queueOperation(() => saveAtomic(write));
      settle(write, result);
      results.push(result);
    }
    const settled = await Promise.allSettled(results);
    const failed = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed !== undefined) throw failed.reason;
  }

  async function saveAtomic(write: PendingWrite): Promise<void> {
    // Encoding happens here, not in `save`, so a burst of saves for one session
    // encodes once instead of once per call.
    const session = write.session;
    const stored = encodeStoredSession(session);
    const locator = encodeSessionLocator(session);
    const opened = await database;
    await new Promise<void>((resolve, reject) => {
      const transaction = opened.transaction(
        [SESSION_STORE, SETTINGS_STORE],
        'readwrite',
      );
      transaction.objectStore(SESSION_STORE).put(stored, session.id);
      transaction.objectStore(SETTINGS_STORE).put(locator, currentKey(session.tabId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
    knownTabs.set(session.id, session.tabId);
  }

  return {
    async load(sessionId): Promise<SanitizedRecordingSession | null> {
      await flush().catch(() => undefined);
      return queueOperation(async () => {
        const value = await execute(
          await database,
          'readonly',
          (store) => store.get(sessionId) as IDBRequest<unknown>,
        );
        if (value === undefined) {
          return null;
        }
        const session = decodeStoredSession(value, sessionId);
        if (session.tabId !== '') {
          knownTabs.set(session.id, session.tabId);
        }
        return session;
      });
    },

    async loadCurrent(tabId): Promise<SanitizedRecordingSession | null> {
      await flush().catch(() => undefined);
      return queueOperation(async () => {
        const opened = await database;
        return new Promise<SanitizedRecordingSession | null>((resolve, reject) => {
          const transaction = opened.transaction(
            [SESSION_STORE, SETTINGS_STORE],
            'readonly',
          );
          let result: SanitizedRecordingSession | null = null;
          const locatorRequest = transaction
            .objectStore(SETTINGS_STORE)
            .get(currentKey(tabId));
          locatorRequest.onsuccess = () => {
            if (locatorRequest.result === undefined) {
              result = null;
              return;
            }
            const locator = decodeSessionLocator(locatorRequest.result, tabId);
            if (locator === null) {
              const recoveredId =
                recoverSessionIdFromLocator(locatorRequest.result) ??
                `corrupt-current:${tabId}`;
              knownTabs.set(recoveredId, tabId);
              result = createCorruptSession(recoveredId, tabId);
              return;
            }
            const sessionRequest = transaction
              .objectStore(SESSION_STORE)
              .get(locator.sessionId);
            sessionRequest.onsuccess = () => {
              if (sessionRequest.result !== undefined) {
                knownTabs.set(locator.sessionId, tabId);
                result = decodeStoredSession(
                  sessionRequest.result,
                  locator.sessionId,
                  tabId,
                );
              } else {
                knownTabs.set(locator.sessionId, tabId);
                result = createCorruptSession(locator.sessionId, tabId);
              }
            };
          };
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
        });
      });
    },

    save(session): Promise<void> {
      knownTabs.set(session.id, session.tabId);
      return new Promise<void>((resolve, reject) => {
        const current = pending.get(session.id);
        if (current === undefined) {
          pending.set(session.id, {
            sessionId: session.id,
            session,
            waiters: [{ resolve, reject }],
          });
        } else {
          current.session = session;
          current.waiters.push({ resolve, reject });
        }
        if (timer === null) {
          timer = setTimeout(() => {
            void flush().catch(() => undefined);
          }, debounceMs);
        }
      });
    },

    async flush(): Promise<void> {
      await flush();
    },

    async clear(sessionId): Promise<void> {
      const canceled = pending.get(sessionId);
      pending.delete(sessionId);
      if (pending.size === 0 && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const result = queueOperation(async () => {
        const opened = await database;
        await new Promise<void>((resolve, reject) => {
          const transaction = opened.transaction(
            [SESSION_STORE, SETTINGS_STORE],
            'readwrite',
          );
          const sessions = transaction.objectStore(SESSION_STORE);
          const settings = transaction.objectStore(SETTINGS_STORE);
          const knownTab = knownTabs.get(sessionId);
          const sessionRequest = sessions.get(sessionId);
          sessionRequest.onsuccess = () => {
            const stored = sessionRequest.result;
            const decoded =
              stored === undefined ? null : decodeStoredSession(stored, sessionId);
            const tabId =
              knownTab ?? (decoded?.tabId === '' ? undefined : decoded?.tabId);
            sessions.delete(sessionId);
            if (tabId === undefined) {
              return;
            }
            const locatorRequest = settings.get(currentKey(tabId));
            locatorRequest.onsuccess = () => {
              const locator = decodeSessionLocator(locatorRequest.result, tabId);
              if (locator?.sessionId === sessionId) {
                settings.delete(currentKey(tabId));
              }
            };
          };
          transaction.oncomplete = () => {
            knownTabs.delete(sessionId);
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
        });
      });
      if (canceled !== undefined) {
        settle(canceled, result);
      }
      await result;
    },

    async clearCurrent(tabId): Promise<void> {
      await flush().catch(() => undefined);
      await queueOperation(async () => {
        const opened = await database;
        await new Promise<void>((resolve, reject) => {
          const transaction = opened.transaction(
            [SESSION_STORE, SETTINGS_STORE],
            'readwrite',
          );
          const sessions = transaction.objectStore(SESSION_STORE);
          const settings = transaction.objectStore(SETTINGS_STORE);
          const locatorRequest = settings.get(currentKey(tabId));
          locatorRequest.onsuccess = () => {
            const sessionId = recoverSessionIdFromLocator(locatorRequest.result);
            if (sessionId !== null) {
              pending.delete(sessionId);
              knownTabs.delete(sessionId);
              sessions.delete(sessionId);
            }
            settings.delete(currentKey(tabId));
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
        });
      });
    },
  };
}
