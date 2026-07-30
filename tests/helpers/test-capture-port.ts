import type {
  HarEntryLike,
  RetrievedContent,
} from '../../src/features/capture/har-types';
import type {
  CaptureEvent,
  CaptureObservation,
  CaptureSource,
} from '../../src/ports/capture-source';
import { stableScreenshotCapture } from './stable-screenshot-capture';

/**
 * Browser-side `CaptureSource` used by end-to-end harness pages. It observes
 * real `fetch` and `XMLHttpRequest` traffic and enriches every observation with
 * genuine `PerformanceResourceTiming` evidence, so the production normalization,
 * redaction, classification, and explanation stages run against real network
 * work without depending on the Chrome DevTools protocol.
 */
export type TestCapturePortOptions = Readonly<{
  /**
   * Normalizes presentation-only capture values for reproducible store PNGs.
   * Runtime traffic still goes through the real fixture origin.
   */
  stableScreenshot?: Readonly<{ runtimeOrigin: string }>;
  target?: Window & typeof globalThis;
  /** Milliseconds to wait for the matching resource timing entry. */
  timingTimeoutMs?: number;
}>;

export type TestCapturePort = CaptureSource &
  Readonly<{
    /** Resolves once every observed request has been emitted. */
    settled(): Promise<void>;
    /**
     * Instruments an additional same-origin window, such as a fixture page
     * loaded in a frame, and returns a detach function.
     */
    attach(frame: Window & typeof globalThis): () => void;
  }>;

type HeaderPair = Readonly<{ name: string; value: string }>;

const STREAMED_MIME_TYPES = ['text/event-stream'];
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

function headerPairs(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => pairs.push({ name, value }));
  return pairs;
}

function isStreamedMime(mime: string | undefined): boolean {
  if (mime === undefined) return false;
  const normalized = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return STREAMED_MIME_TYPES.includes(normalized);
}

function isTextualMime(mime: string | undefined): boolean {
  if (mime === undefined) return true;
  const normalized = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (
    normalized.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized.endsWith('+json') ||
    normalized === 'application/javascript' ||
    normalized === 'application/xml' ||
    normalized.endsWith('+xml') ||
    normalized === 'application/x-www-form-urlencoded'
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

async function requestBodyText(
  body: BodyInit | null | undefined,
): Promise<string | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, name) => {
      parts.push(
        typeof value === 'string'
          ? `content-disposition: form-data; name="${name}"\r\n\r\n${value}`
          : `content-disposition: form-data; name="${name}"; filename="${value.name}"`,
      );
    });
    return parts.join('\r\n--fixture-boundary\r\n');
  }
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return toBase64(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return toBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return undefined;
}

function timingsFrom(
  entry: PerformanceResourceTiming | undefined,
): Record<string, number> {
  if (entry === undefined) {
    return { blocked: 0, dns: 0, connect: 0, ssl: -1, send: 0, wait: 0, receive: 0 };
  }
  const positive = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 0;
  const ssl =
    entry.secureConnectionStart > 0
      ? positive(entry.connectEnd - entry.secureConnectionStart)
      : -1;
  return {
    blocked: positive(entry.domainLookupStart - entry.fetchStart),
    dns: positive(entry.domainLookupEnd - entry.domainLookupStart),
    connect: positive(entry.connectEnd - entry.connectStart),
    ssl,
    send: positive(entry.requestStart - entry.connectEnd),
    wait: positive(entry.responseStart - entry.requestStart),
    receive: positive(entry.responseEnd - entry.responseStart),
  };
}

function suppliedLocally(entry: PerformanceResourceTiming): boolean {
  const deliveryType = (entry as unknown as { deliveryType?: string }).deliveryType;
  return (
    deliveryType === 'cache' || (entry.transferSize === 0 && entry.encodedBodySize > 0)
  );
}

/** HTTP cache hits are reported only when no service worker supplied the bytes. */
function servedFromCache(entry: PerformanceResourceTiming | undefined): boolean {
  return entry !== undefined && entry.workerStart === 0 && suppliedLocally(entry);
}

/**
 * A controlled page routes every request through its worker, so worker delivery
 * is claimed only when the worker itself produced the response bytes.
 */
function servedByWorker(entry: PerformanceResourceTiming | undefined): boolean {
  return entry !== undefined && entry.workerStart > 0 && suppliedLocally(entry);
}

export function createTestCapturePort(
  options: TestCapturePortOptions = {},
): TestCapturePort {
  const target =
    options.target ?? (globalThis as unknown as Window & typeof globalThis);
  const stableScreenshot = options.stableScreenshot;
  const timingTimeoutMs = options.timingTimeoutMs ?? 400;
  const listeners = new Set<(event: CaptureEvent) => void>();
  const consumedTimings = new Set<PerformanceResourceTiming>();
  const inFlight = new Set<Promise<void>>();

  const instrumented = new Map<Window & typeof globalThis, () => void>();
  const frames = new Set<Window & typeof globalThis>();
  let active = false;
  let screenshotSequence = 0;

  function emit(event: CaptureEvent): void {
    for (const listener of listeners) listener(event);
  }

  function track(work: Promise<void>): void {
    const guarded = work.catch(() => undefined);
    inFlight.add(guarded);
    void guarded.finally(() => inFlight.delete(guarded));
  }

  async function resourceTiming(
    win: Window & typeof globalThis,
    url: string,
    startedAfter: number,
  ): Promise<PerformanceResourceTiming | undefined> {
    const deadline = win.performance.now() + timingTimeoutMs;
    for (;;) {
      const entries = win.performance.getEntriesByName(url, 'resource');
      for (const candidate of entries) {
        const entry = candidate as PerformanceResourceTiming;
        if (entry.startTime >= startedAfter && !consumedTimings.has(entry)) {
          consumedTimings.add(entry);
          return entry;
        }
      }
      if (win.performance.now() >= deadline) return undefined;
      await new Promise((done) => win.setTimeout(done, 16));
    }
  }

  function emitObservation(
    entry: HarEntryLike,
    content: RetrievedContent | undefined,
  ): void {
    const observation: CaptureObservation = {
      entry,
      observedAt: Date.now(),
      ...(content === undefined ? {} : { content }),
    };
    emit({ type: 'observation', observation });
  }

  async function responseContent(
    response: Response,
    readable: boolean,
  ): Promise<Readonly<{ content: RetrievedContent | undefined; size: number }>> {
    const mime = response.headers.get('content-type') ?? undefined;
    if (!readable) {
      return {
        content: {
          text: '',
          encoding: '',
          ...(mime === undefined ? {} : { mimeType: mime }),
          state: 'unavailable',
          unavailableReason: 'content-not-retrieved',
        },
        size: 0,
      };
    }
    if (isStreamedMime(mime)) {
      return {
        content: {
          text: '',
          encoding: '',
          ...(mime === undefined ? {} : { mimeType: mime }),
          state: 'streamed',
          unavailableReason: 'streamed-response',
        },
        size: 0,
      };
    }
    try {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength > MAX_TEXT_BYTES) {
        return {
          content: {
            text: '',
            encoding: '',
            ...(mime === undefined ? {} : { mimeType: mime }),
            state: 'unavailable',
            unavailableReason: 'body-too-large',
          },
          size: bytes.byteLength,
        };
      }
      if (isTextualMime(mime)) {
        return {
          content: {
            text: new TextDecoder().decode(bytes),
            encoding: '',
            ...(mime === undefined ? {} : { mimeType: mime }),
          },
          size: bytes.byteLength,
        };
      }
      return {
        content: {
          text: toBase64(bytes),
          encoding: 'base64',
          ...(mime === undefined ? {} : { mimeType: mime }),
        },
        size: bytes.byteLength,
      };
    } catch {
      return {
        content: {
          text: '',
          encoding: '',
          ...(mime === undefined ? {} : { mimeType: mime }),
          state: 'unavailable',
          unavailableReason: 'content-read-failed',
        },
        size: 0,
      };
    }
  }

  function buildEntry(
    input: Readonly<{
      url: string;
      method: string;
      startedDateTime: string;
      requestHeaders: readonly HeaderPair[];
      requestBody: string | undefined;
      requestMime: string | undefined;
      status: number;
      statusText: string;
      responseHeaders: readonly HeaderPair[];
      responseMime: string | undefined;
      responseSize: number;
      redirectUrl: string;
      timing: PerformanceResourceTiming | undefined;
      initiator: string;
    }>,
  ): HarEntryLike {
    const stable =
      stableScreenshot === undefined
        ? undefined
        : stableScreenshotCapture({
            redirectUrl: input.redirectUrl,
            requestHeaders: input.requestHeaders,
            responseHeaders: input.responseHeaders,
            runtimeOrigin: stableScreenshot.runtimeOrigin,
            sequence: screenshotSequence++,
            url: input.url,
          });
    const timings = stable?.timings ?? timingsFrom(input.timing);
    return {
      startedDateTime: stable?.startedDateTime ?? input.startedDateTime,
      time:
        stable?.time ??
        (input.timing === undefined ? 0 : Math.max(0, input.timing.duration)),
      _initiator: { type: input.initiator },
      ...(servedFromCache(input.timing) ? { _fromCache: 'memory' } : {}),
      request: {
        method: input.method,
        url: stable?.url ?? input.url,
        headers: [...(stable?.requestHeaders ?? input.requestHeaders)],
        ...(input.requestBody === undefined
          ? {}
          : {
              postData: {
                mimeType: input.requestMime ?? 'text/plain',
                text: input.requestBody,
              },
            }),
      },
      response: {
        status: input.status,
        statusText: input.statusText,
        headers: [...(stable?.responseHeaders ?? input.responseHeaders)],
        redirectURL: stable?.redirectUrl ?? input.redirectUrl,
        bodySize: input.responseSize,
        content: {
          size: input.responseSize,
          ...(input.responseMime === undefined ? {} : { mimeType: input.responseMime }),
        },
        ...(servedByWorker(input.timing) ? { _fetchedViaServiceWorker: true } : {}),
      },
      timings,
    };
  }

  async function observeFetch(
    win: Window & typeof globalThis,
    request: Request,
    body: string | undefined,
    startedAt: number,
    startedDateTime: string,
    outcome: Readonly<{ response: Response; readable: boolean } | { error: unknown }>,
  ): Promise<void> {
    const timing = await resourceTiming(win, request.url, startedAt);
    if ('error' in outcome) {
      emitObservation(
        buildEntry({
          url: request.url,
          method: request.method,
          startedDateTime,
          requestHeaders: headerPairs(request.headers),
          requestBody: body,
          requestMime: request.headers.get('content-type') ?? undefined,
          status: 0,
          statusText: '',
          responseHeaders: [],
          responseMime: undefined,
          responseSize: 0,
          redirectUrl: '',
          timing,
          initiator: 'fetch',
        }),
        {
          text: '',
          encoding: '',
          state: 'unavailable',
          unavailableReason: 'request-failed',
        },
      );
      return;
    }

    const { response, readable } = outcome;
    const { content, size } = await responseContent(response, readable);
    emitObservation(
      buildEntry({
        url: request.url,
        method: request.method,
        startedDateTime,
        requestHeaders: headerPairs(request.headers),
        requestBody: body,
        requestMime: request.headers.get('content-type') ?? undefined,
        status: response.status,
        statusText: response.statusText,
        responseHeaders: headerPairs(response.headers),
        responseMime: response.headers.get('content-type') ?? undefined,
        responseSize: size,
        redirectUrl: response.redirected ? response.url : '',
        timing,
        initiator: 'fetch',
      }),
      content,
    );
  }

  function installFetch(win: Window & typeof globalThis): () => void {
    const original = win.fetch;
    const native = win.fetch.bind(win);
    win.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (!active) return native(input, init);
      const request = new Request(input as RequestInfo, init);
      const body = await requestBodyText(init?.body ?? null);
      const startedAt = win.performance.now();
      const startedDateTime = new Date().toISOString();
      try {
        const response = await native(input, init);
        // The clone must be taken before the caller consumes the body.
        let observed = response;
        let readable = false;
        try {
          observed = response.clone();
          readable = true;
        } catch {
          readable = false;
        }
        track(
          observeFetch(win, request, body, startedAt, startedDateTime, {
            response: observed,
            readable,
          }),
        );
        return response;
      } catch (error) {
        track(observeFetch(win, request, body, startedAt, startedDateTime, { error }));
        throw error;
      }
    } as typeof fetch;
    return () => {
      win.fetch = original;
    };
  }

  type XhrState = {
    method: string;
    url: string;
    headers: HeaderPair[];
    body: string | undefined;
    startedAt: number;
    startedDateTime: string;
  };
  const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();

  function installXhr(win: Window & typeof globalThis): () => void {
    const proto = win.XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalSetHeader = proto.setRequestHeader;
    const nativeOpen: (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      asynchronous: boolean,
      username: string | null,
      password: string | null,
    ) => void = proto.open;
    const nativeSend = proto.send;
    const nativeSetHeader = proto.setRequestHeader;

    function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      asynchronous = true,
      username: string | null = null,
      password: string | null = null,
    ): void {
      xhrStates.set(this, {
        method,
        url: new URL(String(url), win.location.href).toString(),
        headers: [],
        body: undefined,
        startedAt: 0,
        startedDateTime: '',
      });
      nativeOpen.call(this, method, url, asynchronous, username, password);
    }
    proto.open = patchedOpen as typeof proto.open;

    proto.setRequestHeader = function setRequestHeader(
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      xhrStates.get(this)?.headers.push({ name, value });
      return nativeSetHeader.call(this, name, value);
    };

    proto.send = function send(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const state = xhrStates.get(this);
      if (state !== undefined && active) {
        state.startedAt = win.performance.now();
        state.startedDateTime = new Date().toISOString();
        state.body = typeof body === 'string' ? body : undefined;
        this.addEventListener(
          'loadend',
          () => {
            track(observeXhr(win, this, state));
          },
          { once: true },
        );
      }
      return nativeSend.call(this, body ?? null);
    };

    return () => {
      proto.open = originalOpen;
      proto.send = originalSend;
      proto.setRequestHeader = originalSetHeader;
    };
  }

  async function observeXhr(
    win: Window & typeof globalThis,
    request: XMLHttpRequest,
    state: XhrState,
  ): Promise<void> {
    const timing = await resourceTiming(win, state.url, state.startedAt);
    const rawHeaders = request.getAllResponseHeaders();
    const responseHeaders: HeaderPair[] = rawHeaders
      .split(/\r?\n/u)
      .map((line) => line.split(': '))
      .filter((parts) => parts.length >= 2)
      .map((parts) => ({ name: parts[0]!, value: parts.slice(1).join(': ') }));
    const mime = request.getResponseHeader('content-type') ?? undefined;
    const text =
      request.responseType === '' || request.responseType === 'text'
        ? request.responseText
        : '';

    emitObservation(
      buildEntry({
        url: state.url,
        method: state.method,
        startedDateTime: state.startedDateTime,
        requestHeaders: state.headers,
        requestBody: state.body,
        requestMime: state.headers.find(
          ({ name }) => name.toLowerCase() === 'content-type',
        )?.value,
        status: request.status,
        statusText: request.statusText,
        responseHeaders,
        responseMime: mime,
        responseSize: text.length,
        redirectUrl: '',
        timing,
        initiator: 'xmlhttprequest',
      }),
      request.status === 0
        ? {
            text: '',
            encoding: '',
            state: 'unavailable',
            unavailableReason: 'request-failed',
          }
        : { text, encoding: '', ...(mime === undefined ? {} : { mimeType: mime }) },
    );
  }

  async function settled(): Promise<void> {
    for (let round = 0; round < 60; round += 1) {
      const pending = [...inFlight];
      if (pending.length === 0) return;
      await Promise.all(pending);
      await new Promise((done) => target.setTimeout(done, 16));
    }
  }

  function instrument(win: Window & typeof globalThis): void {
    if (instrumented.has(win)) return;
    const detachFetch = installFetch(win);
    const detachXhr = installXhr(win);
    instrumented.set(win, () => {
      detachFetch();
      detachXhr();
    });
  }

  function release(win: Window & typeof globalThis): void {
    const detach = instrumented.get(win);
    if (detach === undefined) return;
    instrumented.delete(win);
    try {
      detach();
    } catch {
      // A navigated or closed frame no longer needs restoring.
    }
  }

  function uninstall(): void {
    for (const win of [...instrumented.keys()]) release(win);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async begin() {
      if (active) return;
      active = true;
      instrument(target);
      for (const win of [...frames]) instrument(win);
    },
    async reconcile() {
      await settled();
    },
    visibility() {
      // Harness pages stay visible for the whole run.
    },
    async stop() {
      active = false;
      await settled();
      uninstall();
    },
    async dispose() {
      active = false;
      frames.clear();
      uninstall();
      listeners.clear();
    },
    settled,
    attach(frame) {
      frames.add(frame);
      if (active) instrument(frame);
      return () => {
        frames.delete(frame);
        release(frame);
      };
    },
  };
}
