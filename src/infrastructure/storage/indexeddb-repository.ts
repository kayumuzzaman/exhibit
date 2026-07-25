import type { RecordingSession } from '../../domain/model';
import type { SessionRepository } from '../../ports/session-repository';
import {
  decodeSessionLocator,
  decodeStoredSession,
  encodeSessionLocator,
  encodeStoredSession,
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

export function createIndexedDbSessionRepository(
  factory: IDBFactory,
  databaseName = PAYLOADRA_DATABASE,
): SessionRepository {
  const database = openPayloadraDatabase(factory, databaseName);
  const knownTabs = new Map<string, string>();

  function currentKey(tabId: string): string {
    return `current:${tabId}`;
  }

  async function saveAtomic(session: RecordingSession): Promise<void> {
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
    async load(sessionId): Promise<RecordingSession | null> {
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
    },

    async loadCurrent(tabId): Promise<RecordingSession | null> {
      const opened = await database;
      return new Promise<RecordingSession | null>((resolve, reject) => {
        const transaction = opened.transaction(
          [SESSION_STORE, SETTINGS_STORE],
          'readonly',
        );
        let result: RecordingSession | null = null;
        const locatorRequest = transaction
          .objectStore(SETTINGS_STORE)
          .get(currentKey(tabId));
        locatorRequest.onsuccess = () => {
          const locator = decodeSessionLocator(locatorRequest.result, tabId);
          if (locator === null) {
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
            }
          };
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      });
    },

    async save(session): Promise<void> {
      await saveAtomic(session);
    },

    async clear(sessionId): Promise<void> {
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
    },
  };
}
