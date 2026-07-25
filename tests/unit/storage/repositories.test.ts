import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordingSession } from '../../../src/domain/model';
import { addBounded, freezeSession } from '../../../src/domain/ring-buffer';
import { createSession } from '../../../src/domain/session';
import {
  createIndexedDbSessionRepository,
  openPayloadraDatabase,
} from '../../../src/infrastructure/storage/indexeddb-repository';
import {
  createSessionStorageRepository,
  type StorageArea,
} from '../../../src/infrastructure/storage/session-storage-repository';
import {
  decodeStoredSession,
  encodeStoredSession,
  MAX_STORAGE_BYTES,
} from '../../../src/infrastructure/storage/schema';
import { requestWith } from '../../helpers/request-factory';

function recordedSession(
  id = 'tab-5:1000',
  retention: RecordingSession['retention'] = 'ephemeral',
): RecordingSession {
  return freezeSession({
    ...createSession('tab-5', 'https://app.test', 1_000),
    id,
    retention,
    phase: 'recording',
    startedAt: 1_000,
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeStorageArea implements StorageArea {
  readonly values = new Map<string, unknown>();
  readonly setCalls: Record<string, unknown>[] = [];
  readonly removeCalls: (string | readonly string[])[] = [];
  rejectSet: Error | null = null;
  setGate: Promise<void> | null = null;

  async get(key: string): Promise<Record<string, unknown>> {
    return this.values.has(key) ? { [key]: clone(this.values.get(key)) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls.push(clone(items));
    if (this.rejectSet !== null) {
      throw this.rejectSet;
    }
    if (this.setGate !== null) {
      await this.setGate;
    }
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, clone(value));
    }
  }

  async remove(keys: string | readonly string[]): Promise<void> {
    this.removeCalls.push(keys);
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      this.values.delete(key);
    }
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setPath(root: unknown, path: readonly string[], value: unknown): void {
  let cursor = root as Record<string, unknown>;
  for (const segment of path.slice(0, -1)) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path.at(-1)!] = value;
}

function validStoredSession(): unknown {
  const request = {
    ...requestWith({
      id: 'schema-request',
      requestHeaders: [{ name: 'accept', value: 'application/json' }],
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      responseStatusText: 'OK',
      responseText: '{"ok":true}',
      responseMime: 'application/json',
      durationMs: 8,
      initiator: 'fetch',
      fromCache: false,
      fromServiceWorker: false,
      redirectUrl: '',
      classification: {
        kind: 'rest',
        confidence: 'confirmed' as const,
        evidence: ['method and content type'],
        actionId: 'action-1',
      },
    }),
    explanation: {
      outcome: 'success',
      summary: 'Request completed.',
      guidance: ['Inspect response.'],
      evidence: ['HTTP 200'],
    },
  };
  const session = addBounded(
    freezeSession({
      ...recordedSession('schema-1'),
      interactions: [
        {
          id: 'interaction-1',
          tabId: 'tab-5',
          kind: 'click',
          occurredAt: 1_000,
          trust: 'trusted',
          target: { tag: 'button', text: 'Save' },
          url: 'https://app.test',
        },
      ],
      warnings: [
        {
          code: 'request-too-large',
          message: 'Earlier evidence was skipped.',
          requestId: 'earlier',
        },
      ],
    }),
    request,
  );
  return encodeStoredSession(session);
}

function refreshStoredBookkeeping(stored: unknown): void {
  const session = (stored as { session: Record<string, unknown> }).session;
  const requests = session.requests as unknown[];
  const requestBytes = requests.map(
    (request) => new TextEncoder().encode(JSON.stringify(request)).byteLength,
  );
  session.requestBytes = requestBytes;
  session.byteCount = requestBytes.reduce((total, bytes) => total + bytes, 0);
}

async function settleTimers(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe('chrome.storage.session repository', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces saves for 100ms and both promises reflect the latest flush', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);
    const first = repository.save(recordedSession());
    const latest = repository.save(
      freezeSession({ ...recordedSession(), stoppedAt: 2_000 }),
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(area.setCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, latest])).resolves.toEqual([undefined, undefined]);
    expect(area.setCalls).toHaveLength(1);

    const recovered = await repository.load('tab-5:1000');
    expect(recovered?.stoppedAt).toBe(2_000);
    expect(Object.isFrozen(recovered)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects an unsafe debounce value: %s',
    (debounceMs) => {
      expect(() =>
        createSessionStorageRepository(new FakeStorageArea(), { debounceMs }),
      ).toThrow(RangeError);
    },
  );

  it('rejects every coalesced save promise when the quota write fails', async () => {
    const area = new FakeStorageArea();
    area.rejectSet = new Error('QUOTA_BYTES');
    const repository = createSessionStorageRepository(area);
    const first = repository.save(recordedSession());
    const second = repository.save(recordedSession());
    const firstResult = expect(first).rejects.toThrow('QUOTA_BYTES');
    const secondResult = expect(second).rejects.toThrow('QUOTA_BYTES');

    await settleTimers();

    await firstResult;
    await secondResult;
  });

  it('serializes an in-flight write before clear so stale data cannot resurrect', async () => {
    const area = new FakeStorageArea();
    const gate = deferred();
    area.setGate = gate.promise;
    const repository = createSessionStorageRepository(area);
    const save = repository.save(recordedSession());

    await vi.advanceTimersByTimeAsync(100);
    const clear = repository.clear('tab-5:1000');
    gate.resolve();
    await save;
    await clear;

    expect(area.values.size).toBe(0);
  });

  it('cancels a pending debounced snapshot when clear wins the race', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);
    const save = repository.save(recordedSession());
    const clear = repository.clear('tab-5:1000');

    await clear;
    await expect(save).resolves.toBeUndefined();
    await settleTimers();
    expect(area.setCalls).toHaveLength(0);
    expect(area.values.size).toBe(0);
  });

  it('recovers a browser-session snapshot through a fresh adapter instance', async () => {
    const area = new FakeStorageArea();
    const first = createSessionStorageRepository(area);
    const save = first.save(recordedSession());
    await settleTimers();
    await save;

    const recovered = await createSessionStorageRepository(area).load('tab-5:1000');

    expect(recovered).toMatchObject({
      id: 'tab-5:1000',
      phase: 'recording',
      retention: 'ephemeral',
    });
  });

  it('reopens the current session knowing only the inspected tab id', async () => {
    const area = new FakeStorageArea();
    const first = createSessionStorageRepository(area);
    const save = first.save(recordedSession());
    await settleTimers();
    await save;

    const recovered = await createSessionStorageRepository(area).loadCurrent('tab-5');

    expect(recovered?.id).toBe('tab-5:1000');
    expect(area.setCalls[0]).toEqual(
      expect.objectContaining({
        'payloadra:session:tab-5:1000': expect.any(Object),
        'payloadra:current:tab-5': {
          version: 1,
          tabId: 'tab-5',
          sessionId: 'tab-5:1000',
        },
      }),
    );
  });

  it('retains a stale locator and returns null when its snapshot is missing', async () => {
    const area = new FakeStorageArea();
    const locatorKey = 'payloadra:current:tab-5';
    const locator = {
      version: 1,
      tabId: 'tab-5',
      sessionId: 'missing-session',
    };
    area.values.set(locatorKey, locator);

    const recovered = await createSessionStorageRepository(area).loadCurrent('tab-5');

    expect(recovered).toBeNull();
    expect(area.values.get(locatorKey)).toEqual(locator);
  });

  it('does not remove a newer same-tab locator while clearing an old session', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);
    const oldSave = repository.save(recordedSession('old-session'));
    await settleTimers();
    await oldSave;
    const newSave = repository.save(recordedSession('new-session'));
    await settleTimers();
    await newSave;

    await repository.clear('old-session');

    expect((await repository.loadCurrent('tab-5'))?.id).toBe('new-session');
    expect(area.values.has('payloadra:session:old-session')).toBe(false);
    expect(area.values.has('payloadra:session:new-session')).toBe(true);
  });

  it('retains a corrupt locator and returns recoverable local state', async () => {
    const area = new FakeStorageArea();
    const locatorKey = 'payloadra:current:tab-5';
    const corrupt = { version: 1, sessionId: 5 };
    area.values.set(locatorKey, corrupt);

    const recovered = await createSessionStorageRepository(area).loadCurrent('tab-5');

    expect(
      recovered === null ||
        recovered.warnings.some(({ code }) => code === 'corrupt-session'),
    ).toBe(true);
    expect(area.values.get(locatorKey)).toEqual(corrupt);
  });

  it('uses the latest save sequence when sessions for one tab coalesce', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);
    const firstOld = repository.save(recordedSession('old-current'));
    const newer = repository.save(recordedSession('newer-current'));
    const latestOld = repository.save(
      freezeSession({
        ...recordedSession('old-current'),
        stoppedAt: 9_000,
      }),
    );
    await settleTimers();
    await Promise.all([firstOld, newer, latestOld]);

    expect((await repository.loadCurrent('tab-5'))?.id).toBe('old-current');
  });

  it('returns null for absent session and locator keys', async () => {
    const repository = createSessionStorageRepository(new FakeStorageArea());

    expect(await repository.load('absent')).toBeNull();
    expect(await repository.loadCurrent('absent-tab')).toBeNull();
  });

  it('contains a failed pending flush when loading by id or tab', async () => {
    const area = new FakeStorageArea();
    area.rejectSet = new Error('quota');
    const byId = createSessionStorageRepository(area);
    const idSave = byId.save(recordedSession('failed-id'));
    const idFailure = expect(idSave).rejects.toThrow('quota');
    expect(await byId.load('failed-id')).toBeNull();
    await idFailure;

    const byTab = createSessionStorageRepository(area);
    const tabSave = byTab.save(recordedSession('failed-tab'));
    const tabFailure = expect(tabSave).rejects.toThrow('quota');
    expect(await byTab.loadCurrent('tab-5')).toBeNull();
    await tabFailure;
  });

  it('rejects invalid snapshots before scheduling a storage write', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);
    const oversized = {
      ...recordedSession('oversized-storage'),
      origin: 'x'.repeat(MAX_STORAGE_BYTES + 1),
    };

    await expect(repository.save(oversized)).rejects.toThrow(RangeError);
    expect(area.setCalls).toEqual([]);
  });

  it('clears only an unknown exact session key without a global operation', async () => {
    const area = new FakeStorageArea();
    const repository = createSessionStorageRepository(area);

    await repository.clear('unknown-session');

    expect(area.removeCalls).toEqual(['payloadra:session:unknown-session']);
  });

  it('returns a recoverable warning for corrupt storage without deleting evidence', async () => {
    const area = new FakeStorageArea();
    const key = 'payloadra:session:tab-5:1000';
    const corrupt = { version: 1, session: { requests: 'not-an-array' } };
    area.values.set(key, corrupt);

    const recovered = await createSessionStorageRepository(area).load('tab-5:1000');

    expect(recovered?.requests).toEqual([]);
    expect(recovered?.warnings).toContainEqual(
      expect.objectContaining({ code: 'corrupt-session' }),
    );
    expect(area.values.get(key)).toEqual(corrupt);
  });
});

describe('IndexedDB repository', () => {
  it('creates v1 sessions/settings stores and supports clone-faithful CRUD', async () => {
    const factory = new IDBFactory();
    const repository = createIndexedDbSessionRepository(factory);
    const session = recordedSession('persistent-1', 'persistent');

    await repository.save(session);
    const recovered = await repository.load(session.id);
    const database = await openPayloadraDatabase(factory);

    expect([...database.objectStoreNames]).toEqual(['sessions', 'settings']);
    expect(database.version).toBe(1);
    expect(recovered).toEqual(session);
    expect(recovered).not.toBe(session);
    expect(Object.isFrozen(recovered?.requests)).toBe(true);

    await repository.clear(session.id);
    expect(await repository.load(session.id)).toBeNull();
    database.close();
  });

  it('retains malformed stored evidence and returns an empty recoverable session', async () => {
    const factory = new IDBFactory();
    const database = await openPayloadraDatabase(factory);
    const transaction = database.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put({ bad: true }, 'corrupt-1');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

    const repository = createIndexedDbSessionRepository(factory);
    const recovered = await repository.load('corrupt-1');
    const reopened = await openPayloadraDatabase(factory);
    const read = reopened
      .transaction('sessions')
      .objectStore('sessions')
      .get('corrupt-1');
    const raw = await new Promise<unknown>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });

    expect(recovered?.id).toBe('corrupt-1');
    expect(recovered?.requests).toEqual([]);
    expect(recovered?.warnings).toContainEqual(
      expect.objectContaining({ code: 'corrupt-session' }),
    );
    expect(raw).toEqual({ bad: true });
    reopened.close();
  });

  it('isolates separate injected factories', async () => {
    const first = createIndexedDbSessionRepository(new IDBFactory());
    const second = createIndexedDbSessionRepository(new IDBFactory());

    await first.save(recordedSession('only-first', 'persistent'));

    expect(await second.load('only-first')).toBeNull();
  });

  it('reopens the current IndexedDB session knowing only the tab id', async () => {
    const factory = new IDBFactory();
    const first = createIndexedDbSessionRepository(factory);
    await first.save(recordedSession('current-idb', 'persistent'));

    const recovered =
      await createIndexedDbSessionRepository(factory).loadCurrent('tab-5');

    expect(recovered?.id).toBe('current-idb');
    expect(recovered?.retention).toBe('persistent');
  });

  it('protects a newer IndexedDB locator when an older session is cleared', async () => {
    const factory = new IDBFactory();
    const repository = createIndexedDbSessionRepository(factory);
    await repository.save(recordedSession('old-idb', 'persistent'));
    await repository.save(recordedSession('new-idb', 'persistent'));

    await repository.clear('old-idb');

    expect((await repository.loadCurrent('tab-5'))?.id).toBe('new-idb');
    expect(await repository.load('old-idb')).toBeNull();
    expect(await repository.load('new-idb')).not.toBeNull();
  });

  it('retains a stale IndexedDB locator when the target snapshot is missing', async () => {
    const factory = new IDBFactory();
    const database = await openPayloadraDatabase(factory);
    const transaction = database.transaction('settings', 'readwrite');
    const locator = {
      version: 1,
      tabId: 'tab-5',
      sessionId: 'missing-idb',
    };
    transaction.objectStore('settings').put(locator, 'current:tab-5');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    const repository = createIndexedDbSessionRepository(factory);
    expect(await repository.loadCurrent('tab-5')).toBeNull();

    const reopened = await openPayloadraDatabase(factory);
    const request = reopened
      .transaction('settings')
      .objectStore('settings')
      .get('current:tab-5');
    const retained = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(retained).toEqual(locator);
    reopened.close();
  });

  it('retains a corrupt IndexedDB locator and returns null', async () => {
    const factory = new IDBFactory();
    const database = await openPayloadraDatabase(factory);
    const transaction = database.transaction('settings', 'readwrite');
    transaction
      .objectStore('settings')
      .put({ version: 1, tabId: 'tab-5', sessionId: 5 }, 'current:tab-5');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    const repository = createIndexedDbSessionRepository(factory);
    expect(await repository.loadCurrent('tab-5')).toBeNull();
  });

  it('clears missing and corrupt exact sessions without touching unrelated data', async () => {
    const factory = new IDBFactory();
    const repository = createIndexedDbSessionRepository(factory);
    await expect(repository.clear('missing')).resolves.toBeUndefined();

    const database = await openPayloadraDatabase(factory);
    const transaction = database.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put({ bad: true }, 'corrupt-clear');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await expect(repository.clear('corrupt-clear')).resolves.toBeUndefined();
    expect(await repository.load('corrupt-clear')).toBeNull();
  });

  it('handles an upgrade callback when both stores already exist', async () => {
    const createObjectStore = vi.fn();
    const database = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore,
    };
    const request: Record<string, unknown> = { result: database };
    const factory = {
      open: vi.fn(() => {
        queueMicrotask(() => {
          (request.onupgradeneeded as (() => void) | undefined)?.();
          (request.onsuccess as (() => void) | undefined)?.();
        });
        return request;
      }),
    } as unknown as IDBFactory;

    await expect(openPayloadraDatabase(factory, 'existing')).resolves.toBe(database);
    expect(createObjectStore).not.toHaveBeenCalled();
  });

  it.each(['error', 'blocked'] as const)(
    'rejects when opening IndexedDB is %s',
    async (failure) => {
      const request: Record<string, unknown> = {
        error: new Error('open failed'),
      };
      const factory = {
        open: () => {
          queueMicrotask(() => {
            const callback = request[failure === 'error' ? 'onerror' : 'onblocked'] as
              (() => void) | undefined;
            callback?.();
          });
          return request;
        },
      } as unknown as IDBFactory;

      await expect(openPayloadraDatabase(factory)).rejects.toThrow(
        failure === 'blocked' ? 'blocked' : 'open failed',
      );
    },
  );

  it('closes a late database after a blocked open and closes on version change', async () => {
    const close = vi.fn();
    const database = { close, onversionchange: null };
    const request: Record<string, unknown> = {
      result: database,
      error: new Error('blocked'),
    };
    const factory = {
      open: () => request,
    } as unknown as IDBFactory;
    const opened = openPayloadraDatabase(factory);
    (request.onblocked as (() => void) | undefined)?.();
    await expect(opened).rejects.toThrow('blocked');

    (request.onsuccess as (() => void) | undefined)?.();
    expect(close).toHaveBeenCalledTimes(1);
    (request.onerror as (() => void) | undefined)?.();
    (request.onblocked as (() => void) | undefined)?.();

    const secondClose = vi.fn();
    const secondDatabase = { close: secondClose, onversionchange: null };
    const secondRequest: Record<string, unknown> = { result: secondDatabase };
    const secondFactory = {
      open: () => secondRequest,
    } as unknown as IDBFactory;
    const secondOpened = openPayloadraDatabase(secondFactory);
    (secondRequest.onsuccess as (() => void) | undefined)?.();
    await secondOpened;
    expect(secondDatabase.onversionchange).toEqual(expect.any(Function));
    (secondDatabase.onversionchange as unknown as () => void)();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['error', new Error('transaction failed'), 'transaction failed'],
    ['abort', null, 'transaction aborted'],
  ] as const)(
    'rejects an IndexedDB transaction on %s',
    async (failure, transactionError, message) => {
      const request: Record<string, unknown> = {};
      const transaction: Record<string, unknown> = {
        error: transactionError,
        objectStore: () => ({ get: () => request }),
      };
      const database = {
        transaction: () => {
          queueMicrotask(() => {
            const callback = transaction[
              failure === 'error' ? 'onerror' : 'onabort'
            ] as (() => void) | undefined;
            callback?.();
          });
          return transaction;
        },
      };
      const openRequest: Record<string, unknown> = { result: database };
      const factory = {
        open: () => {
          queueMicrotask(() => {
            (openRequest.onsuccess as (() => void) | undefined)?.();
          });
          return openRequest;
        },
      } as unknown as IDBFactory;
      const repository = createIndexedDbSessionRepository(factory);

      await expect(repository.load('failure')).rejects.toThrow(message);
    },
  );

  it.each(['save', 'loadCurrent', 'clear'] as const)(
    'rejects %s when its atomic IndexedDB transaction errors or aborts',
    async (operation) => {
      for (const failure of ['error', 'abort'] as const) {
        const request: Record<string, unknown> = {};
        const transaction: Record<string, unknown> = {
          error: failure === 'error' ? new Error(`${operation} failed`) : null,
          objectStore: () => ({
            get: () => request,
            put: () => request,
            delete: () => request,
          }),
        };
        const database = {
          transaction: () => {
            queueMicrotask(() => {
              const callback = transaction[
                failure === 'error' ? 'onerror' : 'onabort'
              ] as (() => void) | undefined;
              callback?.();
            });
            return transaction;
          },
        };
        const openRequest: Record<string, unknown> = { result: database };
        const factory = {
          open: () => {
            queueMicrotask(() => {
              (openRequest.onsuccess as (() => void) | undefined)?.();
            });
            return openRequest;
          },
        } as unknown as IDBFactory;
        const repository = createIndexedDbSessionRepository(factory);
        const result =
          operation === 'save'
            ? repository.save(recordedSession('atomic-failure', 'persistent'))
            : operation === 'loadCurrent'
              ? repository.loadCurrent('tab-5')
              : repository.clear('atomic-failure');

        await expect(result).rejects.toThrow(
          failure === 'error' ? `${operation} failed` : 'transaction aborted',
        );
      }
    },
  );
});

describe('stored session schema validation', () => {
  const corruptCases: readonly [
    name: string,
    path: readonly string[],
    value: unknown,
  ][] = [
    ['wrong version', ['version'], 2],
    ['missing session object', ['session'], null],
    ['wrong session id', ['session', 'id'], 'other'],
    ['invalid tab id', ['session', 'tabId'], 5],
    ['invalid origin', ['session', 'origin'], null],
    ['invalid phase', ['session', 'phase'], 'paused'],
    ['invalid retention', ['session', 'retention'], 'cloud'],
    ['invalid limits object', ['session', 'limits'], []],
    ['invalid max request count', ['session', 'limits', 'maxRequests'], 0],
    ['unsafe max request cap', ['session', 'limits', 'maxRequests'], 10_001],
    ['unsafe byte cap', ['session', 'limits', 'maxBytes'], MAX_STORAGE_BYTES + 1],
    ['invalid started timestamp', ['session', 'startedAt'], Number.NaN],
    ['invalid stopped timestamp', ['session', 'stoppedAt'], 'later'],
    ['invalid requests', ['session', 'requests'], 'many'],
    ['request is not an object', ['session', 'requests', '0'], null],
    ['invalid request id', ['session', 'requests', '0', 'id'], 1],
    ['invalid request URL', ['session', 'requests', '0', 'url'], null],
    ['invalid request method', ['session', 'requests', '0', 'method'], false],
    ['invalid request time', ['session', 'requests', '0', 'startedAt'], Infinity],
    ['invalid request data', ['session', 'requests', '0', 'request'], []],
    ['invalid request headers', ['session', 'requests', '0', 'request', 'headers'], {}],
    [
      'invalid request header entry',
      ['session', 'requests', '0', 'request', 'headers', '0'],
      null,
    ],
    [
      'invalid request header name',
      ['session', 'requests', '0', 'request', 'headers', '0', 'name'],
      1,
    ],
    [
      'invalid request header value',
      ['session', 'requests', '0', 'request', 'headers', '0', 'value'],
      1,
    ],
    [
      'invalid optional request body',
      ['session', 'requests', '0', 'request', 'body'],
      { state: 'mystery' },
    ],
    ['invalid response data', ['session', 'requests', '0', 'response'], null],
    [
      'invalid response status',
      ['session', 'requests', '0', 'response', 'status'],
      '200',
    ],
    [
      'invalid response status text',
      ['session', 'requests', '0', 'response', 'statusText'],
      200,
    ],
    [
      'invalid response headers',
      ['session', 'requests', '0', 'response', 'headers'],
      null,
    ],
    [
      'invalid body state',
      ['session', 'requests', '0', 'response', 'body', 'state'],
      'mystery',
    ],
    [
      'invalid body size type',
      ['session', 'requests', '0', 'response', 'body', 'size'],
      '12',
    ],
    [
      'negative body size',
      ['session', 'requests', '0', 'response', 'body', 'size'],
      -1,
    ],
    [
      'invalid captured size',
      ['session', 'requests', '0', 'response', 'body', 'capturedSize'],
      Number.NaN,
    ],
    [
      'negative captured size',
      ['session', 'requests', '0', 'response', 'body', 'capturedSize'],
      -1,
    ],
    [
      'captured size exceeds size',
      ['session', 'requests', '0', 'response', 'body', 'capturedSize'],
      999,
    ],
    ['invalid body text', ['session', 'requests', '0', 'response', 'body', 'text'], 1],
    [
      'invalid body MIME',
      ['session', 'requests', '0', 'response', 'body', 'mimeType'],
      false,
    ],
    [
      'invalid body reason',
      ['session', 'requests', '0', 'response', 'body', 'reason'],
      {},
    ],
    ['invalid timing', ['session', 'requests', '0', 'timing'], null],
    ['invalid total duration', ['session', 'requests', '0', 'timing', 'totalMs'], -1],
    ['invalid optional duration', ['session', 'requests', '0', 'timing', 'waitMs'], -1],
    ['invalid evidence', ['session', 'requests', '0', 'evidence'], []],
    [
      'invalid cache evidence',
      ['session', 'requests', '0', 'evidence', 'fromCache'],
      'yes',
    ],
    [
      'invalid service worker evidence',
      ['session', 'requests', '0', 'evidence', 'fromServiceWorker'],
      1,
    ],
    [
      'invalid redirect evidence',
      ['session', 'requests', '0', 'evidence', 'redirectUrl'],
      1,
    ],
    [
      'invalid initiator evidence',
      ['session', 'requests', '0', 'evidence', 'initiator'],
      1,
    ],
    ['invalid classification', ['session', 'requests', '0', 'classification'], null],
    [
      'invalid classification kind',
      ['session', 'requests', '0', 'classification', 'kind'],
      1,
    ],
    [
      'invalid classification confidence',
      ['session', 'requests', '0', 'classification', 'confidence'],
      'certain',
    ],
    [
      'invalid classification evidence',
      ['session', 'requests', '0', 'classification', 'evidence'],
      {},
    ],
    [
      'invalid classification evidence item',
      ['session', 'requests', '0', 'classification', 'evidence', '0'],
      1,
    ],
    [
      'invalid classification action',
      ['session', 'requests', '0', 'classification', 'actionId'],
      1,
    ],
    ['invalid explanation', ['session', 'requests', '0', 'explanation'], null],
    [
      'invalid explanation outcome',
      ['session', 'requests', '0', 'explanation', 'outcome'],
      1,
    ],
    [
      'invalid explanation summary',
      ['session', 'requests', '0', 'explanation', 'summary'],
      1,
    ],
    [
      'invalid explanation guidance',
      ['session', 'requests', '0', 'explanation', 'guidance'],
      {},
    ],
    [
      'invalid explanation guidance item',
      ['session', 'requests', '0', 'explanation', 'guidance', '0'],
      1,
    ],
    [
      'invalid explanation evidence',
      ['session', 'requests', '0', 'explanation', 'evidence'],
      {},
    ],
    [
      'invalid explanation evidence item',
      ['session', 'requests', '0', 'explanation', 'evidence', '0'],
      1,
    ],
    ['invalid byte list', ['session', 'requestBytes'], null],
    ['mismatched byte list', ['session', 'requestBytes'], []],
    ['invalid byte item', ['session', 'requestBytes', '0'], -1],
    ['invalid byte count', ['session', 'byteCount'], -1],
    ['invalid interactions', ['session', 'interactions'], null],
    ['invalid interaction entry', ['session', 'interactions', '0'], null],
    ['invalid interaction id', ['session', 'interactions', '0', 'id'], 1],
    ['invalid interaction tab', ['session', 'interactions', '0', 'tabId'], 1],
    ['invalid interaction kind', ['session', 'interactions', '0', 'kind'], 'hover'],
    ['invalid interaction time', ['session', 'interactions', '0', 'occurredAt'], NaN],
    ['invalid interaction target', ['session', 'interactions', '0', 'target'], 1],
    ['invalid interaction URL', ['session', 'interactions', '0', 'url'], 1],
    [
      'interaction target has unexpected keys',
      ['session', 'interactions', '0', 'target'],
      { tag: 'button', text: 'Save', value: 'secret' },
    ],
    [
      'interaction target tag is not lowercase',
      ['session', 'interactions', '0', 'target', 'tag'],
      'BUTTON',
    ],
    [
      'interaction target tag exceeds its bound',
      ['session', 'interactions', '0', 'target', 'tag'],
      `a${'x'.repeat(32)}`,
    ],
    [
      'interaction target text exceeds 80 Unicode code points',
      ['session', 'interactions', '0', 'target', 'text'],
      '🧪'.repeat(81),
    ],
    [
      'interaction target text contains a secret',
      ['session', 'interactions', '0', 'target', 'text'],
      'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    ],
    [
      'interaction target text is not canonical',
      ['session', 'interactions', '0', 'target', 'text'],
      ' Save   now ',
    ],
    [
      'trusted history interaction',
      ['session', 'interactions', '0', 'kind'],
      'history',
    ],
    [
      'untrusted click interaction',
      ['session', 'interactions', '0', 'trust'],
      'untrusted-hint',
    ],
    [
      'navigation interaction contains a target',
      ['session', 'interactions', '0', 'kind'],
      'navigation',
    ],
    [
      'interaction URL contains a query',
      ['session', 'interactions', '0', 'url'],
      'https://app.test/?token=secret',
    ],
    [
      'interaction URL contains credentials',
      ['session', 'interactions', '0', 'url'],
      'https://user:secret@app.test/',
    ],
    [
      'interaction URL has a different origin',
      ['session', 'interactions', '0', 'url'],
      'https://evil.test/',
    ],
    [
      'interaction tab differs from session',
      ['session', 'interactions', '0', 'tabId'],
      'other-tab',
    ],
    ['invalid eviction count', ['session', 'evictedCount'], -1],
    ['invalid warnings', ['session', 'warnings'], null],
    ['invalid warning entry', ['session', 'warnings', '0'], null],
    ['invalid warning code', ['session', 'warnings', '0', 'code'], 'unknown'],
    ['invalid warning message', ['session', 'warnings', '0', 'message'], 1],
    ['invalid warning request id', ['session', 'warnings', '0', 'requestId'], 1],
    ['forged request bytes', ['session', 'requestBytes', '0'], 1],
    ['forged byte count', ['session', 'byteCount'], 1],
  ];

  it.each(corruptCases)(
    'fails closed for %s without throwing',
    (_name, path, value) => {
      const stored = structuredClone(validStoredSession());
      setPath(stored, path, value);

      const recovered = decodeStoredSession(stored, 'schema-1');

      expect(recovered.requests).toEqual([]);
      expect(recovered.warnings).toContainEqual(
        expect.objectContaining({ code: 'corrupt-session' }),
      );
    },
  );

  it('accepts null-prototype envelopes and optional timing/body fields', () => {
    const stored = structuredClone(validStoredSession()) as Record<string, unknown>;
    Object.setPrototypeOf(stored, null);
    setPath(stored, ['session', 'requests', '0', 'timing', 'blockedMs'], 0);
    setPath(stored, ['session', 'requests', '0', 'timing', 'dnsMs'], 1);
    setPath(stored, ['session', 'requests', '0', 'timing', 'connectMs'], 2);
    setPath(stored, ['session', 'requests', '0', 'timing', 'sendMs'], 3);
    setPath(stored, ['session', 'requests', '0', 'timing', 'waitMs'], 4);
    setPath(stored, ['session', 'requests', '0', 'timing', 'receiveMs'], 5);
    const session = stored.session as Record<string, unknown>;
    const request = (session.requests as Record<string, unknown>[])[0]!;
    const serialized = JSON.stringify(request);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    session.requestBytes = [bytes];
    session.byteCount = bytes;

    const recovered = decodeStoredSession(stored, 'schema-1');

    expect(recovered.requests).toHaveLength(1);
    expect(recovered.requests[0]?.timing.receiveMs).toBe(5);
  });

  it('returns corruption recovery for cyclic or oversized envelopes', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(decodeStoredSession(cyclic, 'cycle').warnings[0]?.code).toBe(
      'corrupt-session',
    );

    const oversized = {
      version: 1,
      padding: 'x'.repeat(MAX_STORAGE_BYTES + 1),
    };
    expect(decodeStoredSession(oversized, 'large').warnings[0]?.code).toBe(
      'corrupt-session',
    );
  });

  it('rejects an oversized serialized session before repository writes', () => {
    const oversized = freezeSession({
      ...recordedSession('oversized'),
      origin: 'x'.repeat(MAX_STORAGE_BYTES + 1),
    });

    expect(() => encodeStoredSession(oversized)).toThrow(RangeError);
  });

  it('never invokes hostile accessors while rejecting unexpected keys', () => {
    const stored = structuredClone(validStoredSession()) as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(stored, 'hostile', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'secret';
      },
    });

    const recovered = decodeStoredSession(stored, 'schema-1');

    expect(reads).toBe(0);
    expect(recovered.warnings[0]?.code).toBe('corrupt-session');
  });

  it('never rehydrates an invalid descriptor secret from persistent evidence', () => {
    const stored = structuredClone(validStoredSession());
    setPath(
      stored,
      ['session', 'interactions', '0', 'target', 'text'],
      'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    );

    const recovered = decodeStoredSession(stored, 'schema-1');

    expect(recovered.interactions).toEqual([]);
    expect(JSON.stringify(recovered)).not.toContain('sk-proj-');
    expect(recovered.warnings[0]?.code).toBe('corrupt-session');
  });

  it('decodes an otherwise-valid Proxy without invoking its get trap', () => {
    const stored = validStoredSession() as object;
    let gets = 0;
    const proxy = new Proxy(stored, {
      get: (target, property, receiver) => {
        gets += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const recovered = decodeStoredSession(proxy, 'schema-1');

    expect(gets).toBe(0);
    expect(recovered.requests[0]?.id).toBe('schema-request');
  });

  it('serializes each request once during valid or mismatched hydration', () => {
    const valid = validStoredSession();
    const stringify = vi.spyOn(JSON, 'stringify');
    const requestSerializationCount = () =>
      stringify.mock.calls.filter(([value]) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return false;
        }
        return (value as Record<string, unknown>).id === 'schema-request';
      }).length;

    const recovered = decodeStoredSession(valid, 'schema-1');
    expect(recovered.requests[0]?.id).toBe('schema-request');
    expect(requestSerializationCount()).toBe(1);

    stringify.mockClear();
    const mismatched = structuredClone(valid) as {
      session: Record<string, unknown>;
    };
    mismatched.session.requestBytes = [1];
    const corrupt = decodeStoredSession(mismatched, 'schema-1');
    expect(corrupt.warnings[0]?.code).toBe('corrupt-session');
    expect(requestSerializationCount()).toBe(1);
    stringify.mockRestore();
  });

  it.each([
    'sparse requests',
    'sparse headers',
    'deep unexpected nesting',
    'huge declared array',
    'huge string',
    'unusual prototype',
    'symbol key',
    'unexpected array key',
  ])('fails closed for hostile plain-data shape: %s', (kind) => {
    const stored = structuredClone(validStoredSession()) as Record<string, unknown>;
    const session = stored.session as Record<string, unknown>;
    const request = (session.requests as Record<string, unknown>[])[0]!;

    if (kind === 'sparse requests') {
      session.requests = new Array(5);
      session.requestBytes = new Array(5);
      session.byteCount = 0;
    } else if (kind === 'sparse headers') {
      (request.request as Record<string, unknown>).headers = new Array(2);
      refreshStoredBookkeeping(stored);
    } else if (kind === 'deep unexpected nesting') {
      let nested: Record<string, unknown> = {};
      const root = nested;
      for (let depth = 0; depth < 40; depth += 1) {
        nested.child = {};
        nested = nested.child as Record<string, unknown>;
      }
      (request.evidence as Record<string, unknown>).unexpected = root;
      refreshStoredBookkeeping(stored);
    } else if (kind === 'huge declared array') {
      (request.request as Record<string, unknown>).headers = new Array(1_000_000);
    } else if (kind === 'huge string') {
      (request.evidence as Record<string, unknown>).initiator = 'x'.repeat(
        2 * 1024 * 1024,
      );
      refreshStoredBookkeeping(stored);
    } else if (kind === 'unusual prototype') {
      Object.setPrototypeOf(request.evidence as object, { inherited: true });
    } else if (kind === 'symbol key') {
      (request.evidence as Record<symbol, unknown>)[Symbol('hidden')] = true;
    } else {
      const headers = (request.request as Record<string, unknown>).headers as unknown[];
      (headers as unknown as Record<string, unknown>).unexpected = true;
    }

    const recovered = decodeStoredSession(stored, 'schema-1');

    expect(recovered.requests).toEqual([]);
    expect(recovered.warnings[0]?.code).toBe('corrupt-session');
  });
});
