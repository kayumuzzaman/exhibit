import type { BodyContent, RequestTiming } from './model';
import type { SanitizedCapturedRequest, SanitizedRecordingSession } from './sanitized';
import { sortedSafeHeaders } from './curl';

const CREATOR = Object.freeze({ name: 'Payloadra', version: '0.1.0' });

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function harTiming(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : -1;
}

function harTimings(timing: RequestTiming) {
  return {
    blocked: harTiming(timing.blockedMs),
    dns: harTiming(timing.dnsMs),
    connect: harTiming(timing.connectMs),
    send: harTiming(timing.sendMs),
    wait: harTiming(timing.waitMs),
    receive: harTiming(timing.receiveMs),
  };
}

function startedDateTime(value: number): string {
  if (!Number.isFinite(value)) return new Date(0).toISOString();
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function queryString(value: string): Array<{ name: string; value: string }> {
  try {
    return [...new URL(value).searchParams]
      .map(([name, parameterValue], index) => ({
        name,
        value: parameterValue,
        index,
      }))
      .sort(
        (left, right) =>
          compareText(left.name, right.name) ||
          compareText(left.value, right.value) ||
          left.index - right.index,
      )
      .map(({ name, value: parameterValue }) => ({
        name,
        value: parameterValue,
      }));
  } catch {
    return [];
  }
}

function bodyMetadata(body: BodyContent) {
  return {
    state: body.state,
    capturedSize: nonNegative(body.capturedSize),
    originalSize: nonNegative(body.size),
    ...(body.reason === undefined ? {} : { reason: body.reason }),
  };
}

function textualBody(body: BodyContent | undefined): body is BodyContent & {
  text: string;
} {
  return (
    body?.text !== undefined &&
    (body.state === 'available' || body.state === 'truncated')
  );
}

function postData(body: BodyContent | undefined) {
  if (!textualBody(body)) return undefined;
  return {
    mimeType: body.mimeType ?? 'text/plain',
    text: body.text,
    _payloadra: bodyMetadata(body),
  };
}

function responseContent(body: BodyContent) {
  return {
    size: nonNegative(body.size),
    mimeType: body.mimeType ?? 'application/octet-stream',
    ...(textualBody(body) ? { text: body.text } : {}),
    _payloadra: bodyMetadata(body),
  };
}

function entry(request: SanitizedCapturedRequest) {
  const safeRequestHeaders = sortedSafeHeaders(request.request.headers);
  const safeResponseHeaders = sortedSafeHeaders(request.response.headers);
  const requestPostData = postData(request.request.body);
  return {
    startedDateTime: startedDateTime(request.startedAt),
    time: nonNegative(request.timing.totalMs),
    request: {
      method: request.method,
      url: request.url,
      httpVersion: 'HTTP/unknown',
      headers: safeRequestHeaders.map(({ name, value }) => ({ name, value })),
      queryString: queryString(request.url),
      cookies: [],
      headersSize: -1,
      bodySize:
        request.request.body === undefined ? 0 : nonNegative(request.request.body.size),
      ...(requestPostData === undefined ? {} : { postData: requestPostData }),
    },
    response: {
      status: request.response.status,
      statusText: request.response.statusText ?? '',
      httpVersion: 'HTTP/unknown',
      headers: safeResponseHeaders.map(({ name, value }) => ({ name, value })),
      cookies: [],
      content: responseContent(request.response.body),
      redirectURL: request.evidence.redirectUrl ?? '',
      headersSize: -1,
      bodySize: nonNegative(request.response.body.size),
    },
    cache: {},
    timings: harTimings(request.timing),
    _payloadra: {
      sanitized: true,
      requestId: request.id,
      cache: request.evidence.fromCache === true,
      serviceWorker: request.evidence.fromServiceWorker === true,
      ...(request.classification === undefined
        ? {}
        : {
            classification: {
              kind: request.classification.kind,
              confidence: request.classification.confidence,
              evidence: [...request.classification.evidence],
            },
          }),
      ...(request.explanation === undefined
        ? {}
        : { outcome: request.explanation.outcome }),
    },
  };
}

function sortedRequests(
  requests: readonly SanitizedCapturedRequest[],
): SanitizedCapturedRequest[] {
  return requests
    .map((request, index) => ({ request, index }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.request.startedAt)
        ? left.request.startedAt
        : Number.POSITIVE_INFINITY;
      const rightTime = Number.isFinite(right.request.startedAt)
        ? right.request.startedAt
        : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ request }) => request);
}

export function toSanitizedHar(session: SanitizedRecordingSession): string {
  const output = {
    log: {
      version: '1.2',
      creator: CREATOR,
      entries: sortedRequests(session.requests).map(entry),
      _payloadra: {
        sanitized: true,
        sessionId: session.id,
        origin: session.origin,
        retention: session.retention,
        startedAt:
          session.startedAt === null ? null : startedDateTime(session.startedAt),
        stoppedAt:
          session.stoppedAt === null ? null : startedDateTime(session.stoppedAt),
        evictedCount: session.evictedCount,
        warningCodes: session.warnings.map(({ code }) => code).sort(),
      },
    },
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}
