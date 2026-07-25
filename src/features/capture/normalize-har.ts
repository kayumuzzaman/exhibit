import type {
  BodyContent,
  CapturedRequest,
  Header,
  RequestTiming,
  SessionLimits,
} from '../../domain/model';
import type { CaptureObservation } from '../../ports/capture-source';
import { applyBodyPolicy, effectiveBodyLimit } from './body-policy';
import { normalizeEvidence } from './evidence';
import type { RetrievedContent } from './har-types';

const MAX_HAR_COLLECTION_ITEMS = 10_000;
const FORM_CHUNK_SIZE = 4_096;
const HEX_DIGITS = '0123456789ABCDEF';

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

function boundedArrayLength(value: unknown): number | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
  } catch {
    return undefined;
  }
  const length = finiteNonNegative(ownData(value, 'length'));
  return length === undefined
    ? undefined
    : Math.min(Math.floor(length), MAX_HAR_COLLECTION_ITEMS);
}

function normalizeHeaders(value: unknown): readonly Header[] {
  const length = boundedArrayLength(value);
  if (length === undefined) return [];
  const headers: Header[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = ownData(value, String(index));
    const name = stringValue(ownData(item, 'name'));
    const headerValue = stringValue(ownData(item, 'value'));
    if (name !== undefined && headerValue !== undefined) {
      headers.push({ name, value: headerValue });
    }
  }
  return headers;
}

type FormAccumulator = {
  totalSize: number;
  capturedSize: number;
  prefixComplete: boolean;
  buffer: string;
  segments: string[];
};

function appendFormChunk(
  accumulator: FormAccumulator,
  chunk: string,
  limit: number,
): void {
  accumulator.totalSize = Math.min(
    Number.MAX_SAFE_INTEGER,
    accumulator.totalSize + chunk.length,
  );
  if (accumulator.prefixComplete || accumulator.capturedSize + chunk.length > limit) {
    accumulator.prefixComplete = true;
    return;
  }

  accumulator.buffer += chunk;
  accumulator.capturedSize += chunk.length;
  if (accumulator.buffer.length >= FORM_CHUNK_SIZE) {
    accumulator.segments.push(accumulator.buffer);
    accumulator.buffer = '';
  }
}

function percentByte(byte: number): string {
  return `%${HEX_DIGITS.charAt(byte >>> 4)}${HEX_DIGITS.charAt(byte & 0x0f)}`;
}

function appendFormComponent(
  accumulator: FormAccumulator,
  value: string,
  limit: number,
): void {
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.codePointAt(index)!;
    if (codePoint > 0xffff) index += 1;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;

    const unescaped =
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a) ||
      (codePoint >= 0x30 && codePoint <= 0x39) ||
      codePoint === 0x2a ||
      codePoint === 0x2d ||
      codePoint === 0x2e ||
      codePoint === 0x5f;
    if (unescaped) {
      appendFormChunk(accumulator, String.fromCodePoint(codePoint), limit);
    } else if (codePoint === 0x20) {
      appendFormChunk(accumulator, '+', limit);
    } else if (codePoint <= 0x7f) {
      appendFormChunk(accumulator, percentByte(codePoint), limit);
    } else if (codePoint <= 0x7ff) {
      appendFormChunk(
        accumulator,
        percentByte(0xc0 | (codePoint >>> 6)) + percentByte(0x80 | (codePoint & 0x3f)),
        limit,
      );
    } else if (codePoint <= 0xffff) {
      appendFormChunk(
        accumulator,
        percentByte(0xe0 | (codePoint >>> 12)) +
          percentByte(0x80 | ((codePoint >>> 6) & 0x3f)) +
          percentByte(0x80 | (codePoint & 0x3f)),
        limit,
      );
    } else {
      appendFormChunk(
        accumulator,
        percentByte(0xf0 | (codePoint >>> 18)) +
          percentByte(0x80 | ((codePoint >>> 12) & 0x3f)) +
          percentByte(0x80 | ((codePoint >>> 6) & 0x3f)) +
          percentByte(0x80 | (codePoint & 0x3f)),
        limit,
      );
    }
  }
}

function normalizedFormBody(
  params: unknown,
  length: number,
  mime: string | undefined,
  maxBodyBytes: number,
): BodyContent {
  const limit = effectiveBodyLimit(maxBodyBytes);
  const accumulator: FormAccumulator = {
    totalSize: 0,
    capturedSize: 0,
    prefixComplete: false,
    buffer: '',
    segments: [],
  };
  let pairCount = 0;

  for (let index = 0; index < length; index += 1) {
    const parameter = ownData(params, String(index));
    const name = stringValue(ownData(parameter, 'name'));
    const value = stringValue(ownData(parameter, 'value'));
    if (name === undefined || value === undefined) continue;
    if (pairCount > 0) appendFormChunk(accumulator, '&', limit);
    appendFormComponent(accumulator, name, limit);
    appendFormChunk(accumulator, '=', limit);
    appendFormComponent(accumulator, value, limit);
    pairCount += 1;
  }

  if (accumulator.buffer.length > 0) {
    accumulator.segments.push(accumulator.buffer);
  }
  const text = accumulator.segments.join('');
  const mimeType =
    mime === undefined
      ? 'application/x-www-form-urlencoded'
      : mime.length > 0
        ? mime
        : undefined;
  if (accumulator.totalSize > accumulator.capturedSize) {
    return {
      state: 'truncated',
      size: accumulator.totalSize,
      capturedSize: accumulator.capturedSize,
      text,
      ...(mimeType === undefined ? {} : { mimeType }),
      reason: 'body-limit',
    };
  }
  return {
    state: 'available',
    size: accumulator.totalSize,
    capturedSize: accumulator.capturedSize,
    text,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
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
  const length = boundedArrayLength(params);
  if (length === undefined) return applyBodyPolicy(undefined, 0, limit);
  return normalizedFormBody(params, length, mime, limit);
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
  } = { totalMs: 0 };
  let componentTotal: number | undefined = 0;
  for (const [harField, normalizedField] of map) {
    const value = finiteNonNegative(ownData(source, harField));
    if (value !== undefined) {
      output[normalizedField] = value;
      if (componentTotal !== undefined) {
        componentTotal = finiteNonNegative(componentTotal + value);
      }
    }
  }
  output.totalMs = finiteNonNegative(ownData(entry, 'time')) ?? componentTotal ?? 0;
  return output as RequestTiming;
}

function startedAt(entry: unknown, observedAt: number): number {
  const timestamp = stringValue(ownData(entry, 'startedDateTime'));
  const parsed = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : observedAt;
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
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
  const content = retrievedContent(ownData(observation, 'content'), responseMime);
  const decodedSize = finiteNonNegative(ownData(responseContent, 'size'));
  const transportSize = finiteNonNegative(ownData(response, 'bodySize'));
  const declaredSize =
    decodedSize ?? (content === undefined ? transportSize : undefined) ?? 0;
  const observedAt = finiteNonNegative(ownData(observation, 'observedAt')) ?? 0;
  const statusText = stringValue(ownData(response, 'statusText'));

  return deepFreeze({
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
      ...(statusText === undefined ? {} : { statusText }),
      headers: normalizeHeaders(ownData(response, 'headers')),
      body: applyBodyPolicy(content, declaredSize, limits.maxBodyBytes),
    },
    timing: timing(entry),
    evidence: normalizeEvidence(entry, response),
  });
}
