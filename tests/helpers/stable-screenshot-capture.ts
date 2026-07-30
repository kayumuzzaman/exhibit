export const SCREENSHOT_ORIGIN = 'http://127.0.0.1:4173';
export const SCREENSHOT_DATE_HEADER = 'Thu, 30 Jul 2026 10:00:00 GMT';

const SCREENSHOT_STARTED_AT = Date.parse('2026-07-30T10:00:00.000Z');

type HeaderPair = Readonly<{ name: string; value: string }>;

type StableCaptureInput = Readonly<{
  redirectUrl: string;
  requestHeaders: readonly HeaderPair[];
  responseHeaders: readonly HeaderPair[];
  runtimeOrigin: string;
  sequence: number;
  url: string;
}>;

type StableCapture = Readonly<{
  redirectUrl: string;
  requestHeaders: readonly HeaderPair[];
  responseHeaders: readonly HeaderPair[];
  startedDateTime: string;
  time: number;
  timings: Readonly<{
    blocked: number;
    connect: number;
    dns: number;
    receive: number;
    send: number;
    ssl: number;
    wait: number;
  }>;
  url: string;
}>;

type StableInteractionInput = Readonly<{
  runtimeOrigin: string;
  sequence: number;
  url: string;
}>;

function replaceRuntimeOrigin(value: string, runtimeOrigin: string): string {
  return runtimeOrigin === ''
    ? value
    : value.replaceAll(runtimeOrigin, SCREENSHOT_ORIGIN);
}

function normalizedHeaders(
  headers: readonly HeaderPair[],
  runtimeOrigin: string,
  response: boolean,
): readonly HeaderPair[] {
  return headers.map(({ name, value }) => ({
    name,
    value:
      response && name.toLowerCase() === 'date'
        ? SCREENSHOT_DATE_HEADER
        : replaceRuntimeOrigin(value, runtimeOrigin),
  }));
}

function timingFor(url: string): StableCapture['timings'] {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // A malformed fixture URL gets the bounded default timing profile.
  }
  const wait = path === '/api/slow' ? 1_198 : path === '/next' ? 6 : 0;
  return {
    blocked: 0,
    connect: 0,
    dns: 0,
    receive: 1,
    send: 1,
    ssl: -1,
    wait,
  };
}

/**
 * Keeps tracked store screenshots stable while the browser still exercises
 * genuine fixture requests. Only presentation-irrelevant clock, timing, port,
 * redirect, and HTTP Date values are normalized.
 */
export function stableScreenshotCapture(input: StableCaptureInput): StableCapture {
  const timings = timingFor(input.url);
  return {
    redirectUrl: replaceRuntimeOrigin(input.redirectUrl, input.runtimeOrigin),
    requestHeaders: normalizedHeaders(input.requestHeaders, input.runtimeOrigin, false),
    responseHeaders: normalizedHeaders(
      input.responseHeaders,
      input.runtimeOrigin,
      true,
    ),
    startedDateTime: new Date(
      SCREENSHOT_STARTED_AT + Math.max(0, input.sequence) * 1_000,
    ).toISOString(),
    time:
      timings.blocked +
      timings.dns +
      timings.connect +
      timings.send +
      timings.wait +
      timings.receive,
    timings,
    url: replaceRuntimeOrigin(input.url, input.runtimeOrigin),
  };
}

export function stableScreenshotInteraction(
  input: StableInteractionInput,
): Readonly<{ id: string; occurredAt: number; url: string }> {
  const sequence = Math.max(0, input.sequence);
  return {
    id: `screenshot-interaction-${sequence}`,
    occurredAt: SCREENSHOT_STARTED_AT + sequence * 1_000,
    url: replaceRuntimeOrigin(input.url, input.runtimeOrigin),
  };
}
