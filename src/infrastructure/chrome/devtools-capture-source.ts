import {
  getRequestContent,
  type ContentResult,
  type RuntimeLastErrorLike,
} from '../../features/capture/get-content';
import type { RetrievedContent } from '../../features/capture/har-types';
import type {
  CaptureEvent,
  CaptureIssue,
  CaptureOptions,
  CaptureSource,
} from '../../ports/capture-source';

export type FinishedRequestLike = object & {
  readonly startedDateTime?: unknown;
  readonly connection?: unknown;
  readonly _requestId?: unknown;
  readonly requestId?: unknown;
  readonly _id?: unknown;
  readonly _resourceType?: unknown;
  readonly resourceType?: unknown;
  readonly type?: unknown;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly timings?: unknown;
  getContent?(
    callback: (content: string, encoding?: string | undefined) => void,
  ): unknown;
};

type HarLike = Readonly<{ entries: readonly FinishedRequestLike[] }>;

export interface DevtoolsNetworkLike {
  readonly onRequestFinished: Readonly<{
    addListener(listener: (request: FinishedRequestLike) => void): void;
    removeListener(listener: (request: FinishedRequestLike) => void): void;
  }>;
  getHAR(callback: (har: HarLike) => void): unknown;
}

export type DevtoolsCaptureDependencies = Readonly<{
  network: DevtoolsNetworkLike;
  runtime?: RuntimeLastErrorLike;
}>;

export type DevtoolsCaptureConfiguration = Readonly<{
  clock?: () => number;
  pollIntervalMs?: number;
  harTimeoutMs?: number;
  contentTimeoutMs?: number;
  contentConcurrency?: number;
}>;

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_HAR_TIMEOUT_MS = 5_000;
const DEFAULT_CONTENT_TIMEOUT_MS = 5_000;
const DEFAULT_CONTENT_CONCURRENCY = 4;
const MAX_CONTENT_CONCURRENCY = 32;
const STATIC_RESOURCE_TYPES = new Set([
  'font',
  'image',
  'media',
  'script',
  'stylesheet',
]);
const API_RESOURCE_TYPES = new Set(['document', 'fetch', 'xhr', 'xmlhttprequest']);

const ISSUES: Readonly<Record<string, CaptureIssue>> = Object.freeze({
  'content-api-unavailable': {
    code: 'content-api-unavailable',
    message: 'Response content was unavailable from the DevTools API.',
  },
  'content-callback-timeout': {
    code: 'content-callback-timeout',
    message: 'Response content retrieval timed out.',
  },
  'invalid-content-encoding': {
    code: 'invalid-content-encoding',
    message: 'Response content used an unsupported DevTools encoding.',
  },
  'har-api-unavailable': {
    code: 'har-api-unavailable',
    message: 'The DevTools HAR snapshot was unavailable.',
  },
  'har-callback-timeout': {
    code: 'har-callback-timeout',
    message: 'The DevTools HAR snapshot timed out.',
  },
  'invalid-har': {
    code: 'invalid-har',
    message: 'The DevTools HAR snapshot was malformed.',
  },
  'invalid-started-time': {
    code: 'invalid-started-time',
    message: 'A network entry was skipped because its start time was invalid.',
  },
});

type HarResult =
  | Readonly<{ ok: true; entries: readonly FinishedRequestLike[] }>
  | Readonly<{
      ok: false;
      issue: CaptureIssue;
    }>;

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function stringData(value: unknown, key: string): string | undefined {
  const result = ownData(value, key);
  return typeof result === 'string' ? result : undefined;
}

function finiteDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function concurrency(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_CONTENT_CONCURRENCY)
    : DEFAULT_CONTENT_CONCURRENCY;
}

function requestPart(entry: FinishedRequestLike): unknown {
  return ownData(entry, 'request');
}

function responsePart(entry: FinishedRequestLike): unknown {
  return ownData(entry, 'response');
}

function responseContent(entry: FinishedRequestLike): unknown {
  return ownData(responsePart(entry), 'content');
}

function headerValue(value: unknown, name: string): string | undefined {
  const headers = ownData(value, 'headers');
  if (!Array.isArray(headers)) return undefined;
  const searched = name.toLowerCase();
  for (const header of headers) {
    const headerName = stringData(header, 'name');
    const headerValue = stringData(header, 'value');
    if (headerName?.toLowerCase() === searched && headerValue !== undefined) {
      return headerValue;
    }
  }
  return undefined;
}

function resourceType(entry: FinishedRequestLike): string {
  return (
    stringData(entry, '_resourceType') ??
    stringData(entry, 'resourceType') ??
    stringData(entry, 'type') ??
    ''
  )
    .trim()
    .toLowerCase();
}

function isCandidate(entry: FinishedRequestLike): boolean {
  const request = requestPart(entry);
  const response = responsePart(entry);
  const method = (stringData(request, 'method') ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return true;

  const type = resourceType(entry);
  if (API_RESOURCE_TYPES.has(type)) return true;

  const status = ownData(response, 'status');
  if (
    (typeof status === 'number' && status >= 300 && status <= 399) ||
    headerValue(response, 'location') !== undefined
  ) {
    return true;
  }

  const contentType = (
    headerValue(request, 'content-type') ??
    stringData(ownData(request, 'postData'), 'mimeType') ??
    ''
  ).toLowerCase();
  if (
    contentType.includes('application/json') ||
    contentType.includes('application/graphql') ||
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    return true;
  }
  if (
    headerValue(request, 'next-action') !== undefined ||
    headerValue(request, 'rsc') !== undefined ||
    headerValue(request, 'next-router-state-tree') !== undefined ||
    headerValue(response, 'content-type')?.toLowerCase().includes('text/x-component')
  ) {
    return true;
  }

  const url = stringData(request, 'url') ?? '';
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.has('_rsc') ||
      /(?:^|\/)graphql(?:\/|$)/iu.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function includeEntry(entry: FinishedRequestLike, options: CaptureOptions): boolean {
  if (options.includeStatic === true || isCandidate(entry)) return true;
  return !STATIC_RESOURCE_TYPES.has(resourceType(entry));
}

function parsedStartedAt(entry: FinishedRequestLike): number | undefined {
  const value = stringData(entry, 'startedDateTime');
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rawDedupeKey(entry: FinishedRequestLike): string {
  const request = requestPart(entry);
  const values = [
    stringData(request, 'method') ?? '',
    stringData(request, 'url') ?? '',
    stringData(entry, 'startedDateTime') ?? '',
    String(ownData(entry, 'connection') ?? ''),
    String(
      ownData(entry, '_requestId') ??
        ownData(entry, 'requestId') ??
        ownData(entry, '_id') ??
        '',
    ),
  ];
  return values.map((value) => `${value.length}:${value}`).join('|');
}

function getHar(
  dependencies: DevtoolsCaptureDependencies,
  timeoutMs: number,
): Promise<HarResult> {
  return new Promise<HarResult>((resolve) => {
    let settled = false;
    const settle = (result: HarResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle({ ok: false, issue: ISSUES['har-callback-timeout']! });
    }, timeoutMs);

    try {
      dependencies.network.getHAR((har) => {
        let hasRuntimeError: boolean;
        try {
          hasRuntimeError = dependencies.runtime?.lastError !== undefined;
        } catch {
          hasRuntimeError = true;
        }
        if (hasRuntimeError) {
          settle({ ok: false, issue: ISSUES['har-api-unavailable']! });
          return;
        }
        const entries = ownData(har, 'entries');
        if (!Array.isArray(entries)) {
          settle({ ok: false, issue: ISSUES['invalid-har']! });
          return;
        }
        settle({
          ok: true,
          entries: entries.filter(
            (entry): entry is FinishedRequestLike =>
              entry !== null && typeof entry === 'object',
          ),
        });
      });
    } catch {
      settle({ ok: false, issue: ISSUES['har-api-unavailable']! });
    }
  });
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  limit: number,
  transform: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await transform(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => worker()),
  );
  return output;
}

export function chromeCaptureSource(
  dependencies: DevtoolsCaptureDependencies,
  configuration: DevtoolsCaptureConfiguration = {},
): CaptureSource {
  const clock = configuration.clock ?? Date.now;
  const pollIntervalMs = finiteDuration(
    configuration.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const harTimeoutMs = finiteDuration(
    configuration.harTimeoutMs,
    DEFAULT_HAR_TIMEOUT_MS,
  );
  const contentTimeoutMs = finiteDuration(
    configuration.contentTimeoutMs,
    DEFAULT_CONTENT_TIMEOUT_MS,
  );
  const contentConcurrency = concurrency(configuration.contentConcurrency);
  const listeners = new Set<(event: CaptureEvent) => void>();
  const eventCounts = new Map<string, number>();
  const harCounts = new Map<string, number>();
  const emittedCounts = new Map<string, number>();
  let options: CaptureOptions = {};
  let active = false;
  let disposed = false;
  let visible = true;
  let listenerAttached = false;
  let startBoundary = 0;
  let stopBoundary = Number.POSITIVE_INFINITY;
  let generation = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let ingestionTail = Promise.resolve();
  let reconciliationInFlight: Promise<void> | null = null;
  let activeContentRetrievals = 0;
  const contentWaiters: Array<() => void> = [];

  function emit(event: CaptureEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Product listeners cannot break capture or other subscribers.
      }
    }
  }

  function issue(value: CaptureIssue): void {
    emit({ type: 'issue', issue: value });
  }

  function clearPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const result = ingestionTail.then(task, task);
    ingestionTail = result.catch(() => undefined);
    return result;
  }

  function validInWindow(entry: FinishedRequestLike): boolean {
    const startedAt = parsedStartedAt(entry);
    if (startedAt === undefined) {
      issue(ISSUES['invalid-started-time']!);
      return false;
    }
    return startedAt >= startBoundary && startedAt <= stopBoundary;
  }

  function desiredMultiplicity(key: string): number {
    return Math.max(eventCounts.get(key) ?? 0, harCounts.get(key) ?? 0);
  }

  async function contentFor(entry: FinishedRequestLike): Promise<RetrievedContent> {
    const mimeType = stringData(responseContent(entry), 'mimeType');
    const getContentMethod = ownData(entry, 'getContent');
    if (typeof getContentMethod !== 'function') {
      issue(ISSUES['content-api-unavailable']!);
      return {
        text: '',
        encoding: '',
        state: 'unavailable',
        unavailableReason: 'content-api-unavailable',
        ...(mimeType === undefined ? {} : { mimeType }),
      };
    }
    const request = {
      getContent(callback: (content: string, encoding?: string) => void): unknown {
        return Reflect.apply(getContentMethod, entry, [callback]);
      },
    };
    const result: ContentResult = await getRequestContent(request, {
      ...(dependencies.runtime === undefined ? {} : { runtime: dependencies.runtime }),
      timeoutMs: contentTimeoutMs,
    });
    if (!result.ok) {
      issue(ISSUES[result.reason]!);
      return {
        text: '',
        encoding: '',
        state: 'unavailable',
        unavailableReason: result.reason,
        ...(mimeType === undefined ? {} : { mimeType }),
      };
    }
    return {
      ...result.content,
      ...(mimeType === undefined ? {} : { mimeType }),
    };
  }

  async function boundedContentFor(
    entry: FinishedRequestLike,
  ): Promise<RetrievedContent> {
    if (activeContentRetrievals < contentConcurrency) {
      activeContentRetrievals += 1;
    } else {
      await new Promise<void>((resolve) => {
        contentWaiters.push(resolve);
      });
    }
    try {
      return await contentFor(entry);
    } finally {
      const next = contentWaiters.shift();
      if (next === undefined) {
        activeContentRetrievals -= 1;
      } else {
        next();
      }
    }
  }

  function emitCandidates(
    candidates: readonly Readonly<{ entry: FinishedRequestLike; key: string }>[],
    contents: readonly RetrievedContent[],
    expectedGeneration: number,
  ): void {
    if (!active || generation !== expectedGeneration) return;
    for (const [index, candidate] of candidates.entries()) {
      if (!active || generation !== expectedGeneration) return;
      const emitted = emittedCounts.get(candidate.key) ?? 0;
      if (emitted >= desiredMultiplicity(candidate.key)) continue;
      emittedCounts.set(candidate.key, emitted + 1);
      emit({
        type: 'observation',
        observation: {
          entry: candidate.entry,
          ...(contents[index] === undefined ? {} : { content: contents[index] }),
          observedAt: clock(),
        },
      });
    }
  }

  async function ingest(
    candidates: readonly Readonly<{ entry: FinishedRequestLike; key: string }>[],
    expectedGeneration: number,
  ): Promise<void> {
    const contents = await mapConcurrent(
      candidates,
      contentConcurrency,
      async ({ entry }) => boundedContentFor(entry),
    );
    emitCandidates(candidates, contents, expectedGeneration);
  }

  function selectEvent(entry: FinishedRequestLike): readonly {
    entry: FinishedRequestLike;
    key: string;
  }[] {
    if (!validInWindow(entry) || !includeEntry(entry, options)) return [];
    const key = rawDedupeKey(entry);
    eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
    return (emittedCounts.get(key) ?? 0) < desiredMultiplicity(key)
      ? [{ entry, key }]
      : [];
  }

  function selectHar(
    entries: readonly FinishedRequestLike[],
  ): readonly Readonly<{ entry: FinishedRequestLike; key: string }>[] {
    const currentCounts = new Map<string, number>();
    const valid: Array<
      Readonly<{ entry: FinishedRequestLike; key: string; index: number }>
    > = [];
    for (const entry of entries) {
      if (!validInWindow(entry) || !includeEntry(entry, options)) continue;
      const key = rawDedupeKey(entry);
      const index = (currentCounts.get(key) ?? 0) + 1;
      currentCounts.set(key, index);
      valid.push({ entry, key, index });
    }
    for (const [key, count] of currentCounts) {
      harCounts.set(key, Math.max(harCounts.get(key) ?? 0, count));
    }
    return valid
      .filter(({ key, index }) => index > (emittedCounts.get(key) ?? 0))
      .map(({ entry, key }) => ({ entry, key }));
  }

  const finishedListener = (request: FinishedRequestLike): void => {
    if (!active) return;
    const expectedGeneration = generation;
    const candidates = selectEvent(request);
    if (candidates.length === 0) return;
    const contents = mapConcurrent(candidates, contentConcurrency, async ({ entry }) =>
      boundedContentFor(entry),
    );
    void contents.catch(() => undefined);
    void enqueue(async () => {
      emitCandidates(candidates, await contents, expectedGeneration);
    });
  };

  function attachListener(): void {
    if (listenerAttached) return;
    dependencies.network.onRequestFinished.addListener(finishedListener);
    listenerAttached = true;
  }

  function detachListener(): void {
    if (!listenerAttached) return;
    dependencies.network.onRequestFinished.removeListener(finishedListener);
    listenerAttached = false;
  }

  async function performReconciliation(expectedGeneration: number): Promise<void> {
    const result = await getHar(dependencies, harTimeoutMs);
    if (!active || generation !== expectedGeneration) return;
    if (!result.ok) {
      issue(result.issue);
      return;
    }
    await enqueue(async () => {
      if (!active || generation !== expectedGeneration) return;
      await ingest(selectHar(result.entries), expectedGeneration);
    });
  }

  function reconcileShared(): Promise<void> {
    if (!active) return Promise.resolve();
    if (reconciliationInFlight !== null) return reconciliationInFlight;
    const expectedGeneration = generation;
    const reconciliation = performReconciliation(expectedGeneration).finally(() => {
      if (reconciliationInFlight === reconciliation) {
        reconciliationInFlight = null;
      }
    });
    reconciliationInFlight = reconciliation;
    return reconciliation;
  }

  function schedulePoll(): void {
    clearPolling();
    if (!active || !visible) return;
    const expectedGeneration = generation;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void reconcileShared().finally(() => {
        if (active && visible && generation === expectedGeneration) schedulePoll();
      });
    }, pollIntervalMs);
  }

  const source: CaptureSource = {
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async begin(startedAt, beginOptions = {}): Promise<void> {
      if (disposed) {
        throw new Error('Capture source was disposed.');
      }
      if (active) return;
      generation += 1;
      startBoundary = startedAt;
      stopBoundary = Number.POSITIVE_INFINITY;
      options = beginOptions;
      eventCounts.clear();
      harCounts.clear();
      emittedCounts.clear();
      active = true;
      attachListener();
      await reconcileShared();
      schedulePoll();
    },

    reconcile(): Promise<void> {
      return reconcileShared();
    },

    visibility(nextVisible): void {
      visible = nextVisible;
      clearPolling();
      if (active && visible) {
        const expectedGeneration = generation;
        void reconcileShared().finally(() => {
          if (active && visible && generation === expectedGeneration) schedulePoll();
        });
      }
    },

    async stop(stoppedAt): Promise<void> {
      if (!active) {
        detachListener();
        return;
      }
      stopBoundary = stoppedAt;
      clearPolling();
      if (reconciliationInFlight !== null) {
        await reconciliationInFlight;
      }
      await performReconciliation(generation);
      await ingestionTail;
      active = false;
      detachListener();
      generation += 1;
      eventCounts.clear();
      harCounts.clear();
      emittedCounts.clear();
    },

    async dispose(): Promise<void> {
      clearPolling();
      if (active) {
        await source.stop(clock());
      }
      disposed = true;
      detachListener();
      listeners.clear();
      eventCounts.clear();
      harCounts.clear();
      emittedCounts.clear();
    },
  };

  return source;
}
