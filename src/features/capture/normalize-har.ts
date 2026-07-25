import type {
  BodyContent,
  CapturedRequest,
  Header,
  RequestTiming,
  SessionLimits,
} from '../../domain/model';
import type { CaptureObservation } from '../../ports/capture-source';
import { applyBodyPolicy } from './body-policy';
import { normalizeEvidence } from './evidence';
import type { RetrievedContent } from './har-types';

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

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeHeaders(value: unknown): readonly Header[] {
  if (!Array.isArray(value)) return [];
  const headers: Header[] = [];
  for (const item of value) {
    const name = stringValue(ownData(item, 'name'));
    const headerValue = stringValue(ownData(item, 'value'));
    if (name !== undefined && headerValue !== undefined) {
      headers.push({ name, value: headerValue });
    }
  }
  return headers;
}

function requestBody(request: unknown, limit: number): BodyContent {
  const postData = ownData(request, 'postData');
  const mime = stringValue(ownData(postData, 'mimeType'));
  const text = stringValue(ownData(postData, 'text'));
  if (text !== undefined) {
    return applyBodyPolicy(
      { text, encoding: '', ...(mime === undefined ? {} : { mimeType: mime }) },
      0,
      limit,
    );
  }
  const params = ownData(postData, 'params');
  if (!Array.isArray(params)) return applyBodyPolicy(undefined, 0, limit);

  const form = new URLSearchParams();
  for (const parameter of params) {
    const name = stringValue(ownData(parameter, 'name'));
    const value = stringValue(ownData(parameter, 'value'));
    if (name !== undefined && value !== undefined) form.append(name, value);
  }
  return applyBodyPolicy(
    {
      text: form.toString(),
      encoding: '',
      mimeType: mime ?? 'application/x-www-form-urlencoded',
    },
    0,
    limit,
  );
}

function timing(entry: unknown): RequestTiming {
  const source = ownData(entry, 'timings');
  const map: ReadonlyArray<readonly [string, keyof RequestTiming]> = [
    ['blocked', 'blockedMs'],
    ['dns', 'dnsMs'],
    ['connect', 'connectMs'],
    ['send', 'sendMs'],
    ['wait', 'waitMs'],
    ['receive', 'receiveMs'],
  ];
  const output: {
    totalMs: number;
    blockedMs?: number;
    dnsMs?: number;
    connectMs?: number;
    sendMs?: number;
    waitMs?: number;
    receiveMs?: number;
  } = {
    totalMs: finiteNonNegative(ownData(entry, 'time')) ?? 0,
  };
  for (const [harField, normalizedField] of map) {
    const value = finiteNonNegative(ownData(source, harField));
    if (value !== undefined) output[normalizedField] = value;
  }
  return output as RequestTiming;
}

function startedAt(entry: unknown, observedAt: number): number {
  const timestamp = stringValue(ownData(entry, 'startedDateTime'));
  const parsed = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : (finiteNonNegative(observedAt) ?? 0);
}

function retrievedContent(
  value: unknown,
  fallbackMime: string | undefined,
): RetrievedContent | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const text = stringValue(ownData(value, 'text'));
  if (text === undefined) return undefined;
  const encoding = ownData(value, 'encoding');
  const mime = stringValue(ownData(value, 'mimeType')) ?? fallbackMime;
  const state = ownData(value, 'state') === 'streamed' ? 'streamed' : undefined;
  const unavailableReason = stringValue(ownData(value, 'unavailableReason'));
  if (encoding !== '' && encoding !== 'base64') return undefined;
  return {
    text,
    encoding: encoding === 'base64' ? 'base64' : '',
    ...(mime === undefined ? {} : { mimeType: mime }),
    ...(state === undefined ? {} : { state }),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

/**
 * Trusted DTO boundary for redaction. Every field is copied from the HAR
 * object; no Chrome object, vendor object, or accessor escapes this function.
 */
export function normalizeObservation(
  observation: CaptureObservation,
  limits: SessionLimits,
): CapturedRequest {
  const entry = ownData(observation, 'entry');
  const request = ownData(entry, 'request');
  const response = ownData(entry, 'response');
  const responseContent = ownData(response, 'content');
  const method = stringValue(ownData(request, 'method')) ?? 'GET';
  const url = stringValue(ownData(request, 'url')) ?? '';
  const responseMime = stringValue(ownData(responseContent, 'mimeType'));
  const declaredSize =
    finiteNonNegative(ownData(response, 'bodySize')) ??
    finiteNonNegative(ownData(responseContent, 'bodySize')) ??
    finiteNonNegative(ownData(responseContent, 'size')) ??
    0;
  const content = retrievedContent(ownData(observation, 'content'), responseMime);
  const observedAt = finiteNonNegative(ownData(observation, 'observedAt')) ?? 0;

  return {
    id: `${method}:${url}:${observedAt}`,
    url,
    method,
    startedAt: startedAt(entry, observedAt),
    request: {
      headers: normalizeHeaders(ownData(request, 'headers')),
      body: requestBody(request, limits.maxBodyBytes),
    },
    response: {
      status: finiteNonNegative(ownData(response, 'status')) ?? 0,
      ...(stringValue(ownData(response, 'statusText')) === undefined
        ? {}
        : { statusText: stringValue(ownData(response, 'statusText'))! }),
      headers: normalizeHeaders(ownData(response, 'headers')),
      body: applyBodyPolicy(content, declaredSize, limits.maxBodyBytes),
    },
    timing: timing(entry),
    evidence: normalizeEvidence(entry, response),
  };
}
