import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chromeCaptureSource,
  type DevtoolsNetworkLike,
  type FinishedRequestLike,
} from '../../../src/infrastructure/chrome/devtools-capture-source';
import type {
  CaptureEvent,
  CaptureObservation,
} from '../../../src/ports/capture-source';

type Har = Readonly<{ entries: readonly FinishedRequestLike[] }>;

function entry(
  id: string,
  startedAt: number,
  overrides: Readonly<Record<string, unknown>> = {},
): FinishedRequestLike {
  const request =
    overrides.request !== null && typeof overrides.request === 'object'
      ? (overrides.request as Record<string, unknown>)
      : {};
  const response =
    overrides.response !== null && typeof overrides.response === 'object'
      ? (overrides.response as Record<string, unknown>)
      : {};
  return {
    startedDateTime: new Date(startedAt).toISOString(),
    connection: overrides.connection ?? 'connection-1',
    _requestId: overrides._requestId ?? id,
    _resourceType: overrides._resourceType,
    request: {
      method: 'GET',
      url: `https://app.test/${id}`,
      headers: [],
      ...request,
    },
    response: {
      status: 200,
      headers: [],
      content: { mimeType: 'application/json', size: 2 },
      ...response,
    },
    timings: {},
    getContent(callback: (content: string, encoding?: string) => void) {
      callback(`{"id":"${id}"}`);
    },
    ...overrides,
  };
}

class FakeNetwork implements DevtoolsNetworkLike {
  readonly listeners = new Set<(request: FinishedRequestLike) => void>();
  readonly added: Array<(request: FinishedRequestLike) => void> = [];
  readonly removed: Array<(request: FinishedRequestLike) => void> = [];
  entries: readonly FinishedRequestLike[] = [];
  getHarCalls = 0;
  getHarImplementation: ((callback: (har: Har) => void) => unknown) | undefined;

  readonly onRequestFinished = {
    addListener: (listener: (request: FinishedRequestLike) => void) => {
      this.added.push(listener);
      this.listeners.add(listener);
    },
    removeListener: (listener: (request: FinishedRequestLike) => void) => {
      this.removed.push(listener);
      this.listeners.delete(listener);
    },
  };

  getHAR(callback: (har: Har) => void): unknown {
    this.getHarCalls += 1;
    if (this.getHarImplementation !== undefined) {
      return this.getHarImplementation(callback);
    }
    callback({ entries: this.entries });
    return {
      then() {
        throw new Error('getHAR return was awaited');
      },
    };
  }

  emit(request: FinishedRequestLike): void {
    for (const listener of this.listeners) listener(request);
  }
}

function observations(events: readonly CaptureEvent[]): readonly CaptureObservation[] {
  return events.flatMap((event) =>
    event.type === 'observation' ? [event.observation] : [],
  );
}

describe('Chrome DevTools capture source', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes before initial HAR and keeps inclusive start/stop boundaries', async () => {
    const network = new FakeNetwork();
    const events: CaptureEvent[] = [];
    network.entries = [entry('before', 999), entry('at-start', 1_000)];
    const source = chromeCaptureSource({ network }, { pollIntervalMs: 1_000 });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    network.entries = [
      ...network.entries,
      entry('at-stop', 2_000),
      entry('after-stop', 2_001),
    ];
    source.visibility(false);
    await source.stop(2_000);

    expect(
      observations(events).map((item) =>
        (item.entry as { request: { url: string } }).request.url.split('/').at(-1),
      ),
    ).toEqual(['at-start', 'at-stop']);
    expect(network.added).toHaveLength(1);
    expect(network.removed).toEqual(network.added);
  });

  it('skips invalid timestamps with a fixed warning and no observedAt fallback', async () => {
    const network = new FakeNetwork();
    network.entries = [
      {
        ...entry('invalid', 1_000),
        startedDateTime: 'not-a-date?token=never-store',
      },
    ];
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(observations(events)).toEqual([]);
    expect(events).toContainEqual({
      type: 'issue',
      issue: {
        code: 'invalid-started-time',
        message: 'A network entry was skipped because its start time was invalid.',
      },
    });
    expect(JSON.stringify(events)).not.toContain('never-store');
  });

  it('deduplicates event/HAR races while preserving identical-request multiplicity', async () => {
    const network = new FakeNetwork();
    const first = entry('same', 1_000, { _requestId: 'vendor-1' });
    const second = entry('same', 1_000, { _requestId: 'vendor-1' });
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    network.emit(first);
    network.entries = [first, second];
    await source.reconcile();
    await source.reconcile();
    await source.stop(2_000);

    expect(observations(events)).toHaveLength(2);
  });

  it('uses method, raw URL, time, connection, and vendor identifier as dedupe key', async () => {
    const network = new FakeNetwork();
    const base = entry('base', 1_000, {
      connection: 'c1',
      _requestId: 'r1',
      request: { method: 'GET', url: 'https://app.test/data?token=raw' },
    });
    network.entries = [
      base,
      {
        ...base,
        request: { method: 'POST', url: 'https://app.test/data?token=raw' },
      },
      { ...base, connection: 'c2' },
      { ...base, _requestId: 'r2' },
    ];
    const seen: CaptureObservation[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => {
      if (event.type === 'observation') seen.push(event.observation);
    });

    await source.begin(1_000);
    await source.stop(2_000);

    expect(seen).toHaveLength(4);
  });

  it('filters only explicit static resource types and retains API candidates', async () => {
    const network = new FakeNetwork();
    network.entries = [
      entry('image', 1_000, { _resourceType: 'image' }),
      entry('font', 1_001, { _resourceType: 'font' }),
      entry('media', 1_002, { _resourceType: 'media' }),
      entry('style', 1_003, { _resourceType: 'stylesheet' }),
      entry('script', 1_004, { _resourceType: 'script' }),
      entry('mutation', 1_005, {
        _resourceType: 'image',
        request: { method: 'POST', url: 'https://app.test/save.png' },
      }),
      entry('fetch', 1_006, {
        _resourceType: 'fetch',
        response: { status: 0 },
      }),
      entry('xhr', 1_007, { _resourceType: 'xhr' }),
      entry('document', 1_008, { _resourceType: 'document' }),
      entry('redirect', 1_009, {
        _resourceType: 'script',
        response: { status: 302, headers: [{ name: 'location', value: '/next' }] },
      }),
      entry('graphql', 1_010, {
        _resourceType: 'script',
        request: {
          method: 'GET',
          url: 'https://app.test/graphql',
          headers: [{ name: 'content-type', value: 'application/json' }],
        },
      }),
      entry('rsc', 1_011, {
        _resourceType: 'script',
        request: {
          method: 'GET',
          url: 'https://app.test/page?_rsc=secret',
          headers: [],
        },
      }),
      entry('form', 1_012, {
        _resourceType: 'script',
        request: {
          method: 'GET',
          url: 'https://app.test/form',
          headers: [
            {
              name: 'content-type',
              value: 'application/x-www-form-urlencoded',
            },
          ],
        },
      }),
      entry('server-action', 1_013, {
        _resourceType: 'script',
        request: {
          method: 'GET',
          url: 'https://app.test/action',
          headers: [{ name: 'Next-Action', value: 'opaque-action-id' }],
        },
      }),
      entry('mime-only', 1_014, {
        response: { content: { mimeType: 'image/png', size: 2 } },
      }),
      entry('suffix-only.png', 1_015),
    ];
    const kept: string[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => {
      if (event.type !== 'observation') return;
      kept.push((event.observation.entry as { request: { url: string } }).request.url);
    });

    await source.begin(1_000, { includeStatic: false });
    await source.stop(2_000);

    expect(kept).toEqual([
      'https://app.test/save.png',
      'https://app.test/fetch',
      'https://app.test/xhr',
      'https://app.test/document',
      'https://app.test/redirect',
      'https://app.test/graphql',
      'https://app.test/page?_rsc=secret',
      'https://app.test/form',
      'https://app.test/action',
      'https://app.test/mime-only',
      'https://app.test/suffix-only.png',
    ]);
  });

  it('retains explicit static resources when includeStatic is enabled', async () => {
    const network = new FakeNetwork();
    network.entries = [entry('script', 1_000, { _resourceType: 'script' })];
    const seen: CaptureObservation[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => {
      if (event.type === 'observation') seen.push(event.observation);
    });

    await source.begin(1_000, { includeStatic: true });
    await source.stop(2_000);

    expect(seen).toHaveLength(1);
  });

  it('bounds content retrieval and emits a HAR batch in deterministic order', async () => {
    const network = new FakeNetwork();
    let active = 0;
    let maximumActive = 0;
    const callbacks: Array<(content: string) => void> = [];
    network.entries = ['first', 'second', 'third'].map((id, index) => ({
      ...entry(id, 1_000 + index),
      getContent(callback: (content: string) => void) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        callbacks.push((content) => {
          active -= 1;
          callback(content);
        });
      },
    }));
    const seen: string[] = [];
    const source = chromeCaptureSource(
      { network },
      { contentConcurrency: 2, contentTimeoutMs: 1_000 },
    );
    source.subscribe((event) => {
      if (event.type === 'observation') {
        seen.push(
          (event.observation.entry as { request: { url: string } }).request.url,
        );
      }
    });

    const beginning = source.begin(1_000);
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[1]?.('second');
    await vi.waitFor(() => expect(callbacks).toHaveLength(3));
    callbacks[2]?.('third');
    callbacks[0]?.('first');
    await beginning;
    await source.stop(2_000);

    expect(maximumActive).toBe(2);
    expect(seen).toEqual([
      'https://app.test/first',
      'https://app.test/second',
      'https://app.test/third',
    ]);
  });

  it('drains stalled live content in bounded waves without duplicates or reordering', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const live = Array.from({ length: 8 }, (_unused, index) => ({
      ...entry(`live-${index}`, 1_000 + index),
      getContent() {},
    }));
    const seen: string[] = [];
    const source = chromeCaptureSource(
      { network },
      {
        contentConcurrency: 4,
        contentTimeoutMs: 25,
        pollIntervalMs: 1_000,
      },
    );
    source.subscribe((event) => {
      if (event.type === 'observation') {
        seen.push(
          (event.observation.entry as { request: { url: string } }).request.url,
        );
      }
    });

    await source.begin(1_000);
    for (const request of live) network.emit(request);
    network.entries = live;
    const startedAt = Date.now();
    let stoppedAfter = Number.POSITIVE_INFINITY;
    const stopping = source.stop(2_000).then(() => {
      stoppedAfter = Date.now() - startedAt;
    });

    await vi.advanceTimersByTimeAsync(200);
    await stopping;

    expect(stoppedAfter).toBe(50);
    expect(seen).toEqual(
      Array.from({ length: 8 }, (_unused, index) => {
        return `https://app.test/live-${index}`;
      }),
    );
  });

  it('uses recursive polling, pauses hidden, and reconciles immediately when shown', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    let pendingHar: ((har: Har) => void) | undefined;
    network.getHarImplementation = (callback) => {
      pendingHar = callback;
    };
    const source = chromeCaptureSource(
      { network },
      { pollIntervalMs: 1_000, harTimeoutMs: 10_000 },
    );

    const beginning = source.begin(1_000);
    pendingHar?.({ entries: [] });
    await beginning;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(network.getHarCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(network.getHarCalls).toBe(2);

    source.visibility(false);
    pendingHar?.({ entries: [] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(network.getHarCalls).toBe(2);

    source.visibility(true);
    await vi.waitFor(() => expect(network.getHarCalls).toBe(3));
    pendingHar?.({ entries: [] });
    const stopping = source.stop(2_000);
    await vi.waitFor(() => expect(network.getHarCalls).toBe(4));
    pendingHar?.({ entries: [] });
    await stopping;
  });

  it('reuses one stable listener across restart and dispose clears it', async () => {
    const network = new FakeNetwork();
    const source = chromeCaptureSource({ network });

    await source.begin(1_000);
    await source.stop(2_000);
    await source.begin(3_000);
    await source.stop(4_000);
    await source.dispose();

    expect(network.added).toHaveLength(2);
    expect(new Set(network.added)).toHaveLength(1);
    expect(network.listeners.size).toBe(0);
  });

  it('reports getHAR throws and timeouts without leaking exception text', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const events: CaptureEvent[] = [];
    network.getHarImplementation = () => {
      throw new Error('Bearer har-secret');
    };
    const source = chromeCaptureSource({ network }, { harTimeoutMs: 25 });
    source.subscribe((event) => events.push(event));
    await source.begin(1_000);

    const lateCallbacks: Array<(har: Har) => void> = [];
    network.getHarImplementation = (callback) => {
      lateCallbacks.push(callback);
    };
    const reconciliation = source.reconcile();
    await vi.advanceTimersByTimeAsync(25);
    await reconciliation;
    lateCallbacks[0]?.({
      entries: [entry('late?token=late-secret', 1_500)],
    });
    const stopping = source.stop(2_000);
    await vi.advanceTimersByTimeAsync(25);
    await stopping;
    lateCallbacks[1]?.({
      entries: [entry('later?token=later-secret', 1_600)],
    });

    expect(events.filter((event) => event.type === 'issue')).toEqual([
      {
        type: 'issue',
        issue: {
          code: 'har-api-unavailable',
          message: 'The DevTools HAR snapshot was unavailable.',
        },
      },
      {
        type: 'issue',
        issue: {
          code: 'har-callback-timeout',
          message: 'The DevTools HAR snapshot timed out.',
        },
      },
      {
        type: 'issue',
        issue: {
          code: 'har-callback-timeout',
          message: 'The DevTools HAR snapshot timed out.',
        },
      },
    ]);
    expect(observations(events)).toEqual([]);
    expect(JSON.stringify(events)).not.toMatch(/har-secret|late-secret|later-secret/u);
  });

  it('settles a double getHAR callback once using the first snapshot', async () => {
    const network = new FakeNetwork();
    network.getHarImplementation = (callback) => {
      callback({ entries: [entry('first', 1_000)] });
      callback({ entries: [entry('second', 1_001)] });
    };
    const seen: string[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => {
      if (event.type === 'observation') {
        seen.push(
          (event.observation.entry as { request: { url: string } }).request.url,
        );
      }
    });

    await source.begin(1_000);
    await source.stop(2_000);

    expect(seen).toEqual(['https://app.test/first']);
  });
});

describe('Chrome DevTools capture source boundaries', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes non-idempotent, API, RSC, and GraphQL traffic while dropping static assets', async () => {
    const network = new FakeNetwork();
    network.entries = [
      entry('posted', 1_000, { request: { method: 'POST' } }),
      entry('xhr', 1_001, { _resourceType: 'xhr' }),
      entry('flight', 1_002, {
        response: {
          status: 200,
          headers: [{ name: 'content-type', value: 'text/x-component' }],
          content: { mimeType: 'text/x-component', size: 2 },
        },
      }),
      entry('router', 1_003, {
        request: {
          method: 'GET',
          url: 'https://app.test/router',
          headers: [{ name: 'next-router-state-tree', value: '%5B%5D' }],
        },
      }),
      entry('rsc', 1_004, {
        request: {
          method: 'GET',
          url: 'https://app.test/page?_rsc=abc',
          headers: [],
        },
      }),
      entry('graphql', 1_005, {
        request: { method: 'GET', url: 'https://app.test/graphql', headers: [] },
      }),
      entry('opaque', 1_006, {
        request: { method: 'GET', url: 'payloadra-opaque', headers: [] },
        _resourceType: 'image',
      }),
      entry('style', 1_007, { _resourceType: 'stylesheet' }),
    ];
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    const seen = observations(events).map(
      (item) => (item.entry as { _requestId: string })._requestId,
    );
    expect(seen).toEqual(['posted', 'xhr', 'flight', 'router', 'rsc', 'graphql']);
  });

  it('keeps static assets when the caller opts in', async () => {
    const network = new FakeNetwork();
    network.entries = [entry('style', 1_000, { _resourceType: 'stylesheet' })];
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000, { includeStatic: true });
    await source.stop(2_000);

    expect(observations(events)).toHaveLength(1);
  });

  it('reports an unavailable content API without dropping the observation', async () => {
    const network = new FakeNetwork();
    const withoutContent = { ...entry('no-content', 1_000) };
    Reflect.deleteProperty(withoutContent as Record<string, unknown>, 'getContent');
    network.entries = [withoutContent];
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(observations(events)[0]?.content).toMatchObject({
      state: 'unavailable',
      unavailableReason: 'content-api-unavailable',
    });
    expect(events.some((event) => event.type === 'issue')).toBe(true);
  });

  it('reports a runtime error from the HAR callback as an unavailable API', async () => {
    const network = new FakeNetwork();
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({
      network,
      runtime: { lastError: { message: 'devtools detached' } },
    });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(
      events.flatMap((event) => (event.type === 'issue' ? [event.issue.code] : [])),
    ).toContain('har-api-unavailable');
  });

  it('treats a throwing runtime accessor as an unavailable API', async () => {
    const network = new FakeNetwork();
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({
      network,
      runtime: {
        get lastError(): never {
          throw new Error('context invalidated');
        },
      },
    });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(
      events.flatMap((event) => (event.type === 'issue' ? [event.issue.code] : [])),
    ).toContain('har-api-unavailable');
  });

  it('reports a malformed HAR payload', async () => {
    const network = new FakeNetwork();
    network.getHarImplementation = (callback) => {
      (callback as unknown as (value: unknown) => void)({ entries: 'not-an-array' });
    };
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(
      events.flatMap((event) => (event.type === 'issue' ? [event.issue.code] : [])),
    ).toContain('invalid-har');
  });

  it('reports a throwing HAR API without breaking the session', async () => {
    const network = new FakeNetwork();
    network.getHarImplementation = () => {
      throw new Error('getHAR unavailable');
    };
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);

    expect(
      events.flatMap((event) => (event.type === 'issue' ? [event.issue.code] : [])),
    ).toContain('har-api-unavailable');
  });

  it('emits live listener traffic and reconciles it only once', async () => {
    const network = new FakeNetwork();
    const live = entry('live', 1_500);
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    network.emit(live);
    network.entries = [live];
    await source.reconcile();
    await source.stop(2_000);

    expect(observations(events)).toHaveLength(1);
  });

  it('ignores listener traffic once recording stops', async () => {
    const network = new FakeNetwork();
    const events: CaptureEvent[] = [];
    const source = chromeCaptureSource({ network });
    source.subscribe((event) => events.push(event));

    await source.begin(1_000);
    await source.stop(2_000);
    network.emit(entry('late', 1_500));

    expect(observations(events)).toHaveLength(0);
  });

  it('polls while visible and stops polling when hidden', async () => {
    vi.useFakeTimers();
    const network = new FakeNetwork();
    const source = chromeCaptureSource({ network }, { pollIntervalMs: 50 });

    await source.begin(1_000);
    const afterBegin = network.getHarCalls;

    await vi.advanceTimersByTimeAsync(120);
    expect(network.getHarCalls).toBeGreaterThan(afterBegin);

    source.visibility(false);
    const afterHide = network.getHarCalls;
    await vi.advanceTimersByTimeAsync(200);
    expect(network.getHarCalls).toBe(afterHide);

    source.visibility(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(network.getHarCalls).toBeGreaterThan(afterHide);

    await source.stop(2_000);
  });

  it('ignores a second begin and refuses to begin after disposal', async () => {
    const network = new FakeNetwork();
    const source = chromeCaptureSource({ network });

    await source.begin(1_000);
    const calls = network.getHarCalls;
    await source.begin(1_000);
    expect(network.getHarCalls).toBe(calls);

    await source.dispose();
    await expect(source.begin(1_000)).rejects.toThrow('Capture source was disposed.');
  });

  it('detaches the listener when stopping an inactive source', async () => {
    const network = new FakeNetwork();
    const source = chromeCaptureSource({ network });

    await source.stop(2_000);
    await source.reconcile();

    expect(network.added).toHaveLength(0);
    expect(network.getHarCalls).toBe(0);
  });

  it('disposes an idle source without stopping twice', async () => {
    const network = new FakeNetwork();
    const source = chromeCaptureSource({ network });

    await source.dispose();
    await source.dispose();

    expect(network.removed).toHaveLength(0);
  });
});
