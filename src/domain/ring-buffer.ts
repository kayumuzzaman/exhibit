import type { SessionLimits, SessionWarning } from './model';
import type {
  SanitizedCapturedRequest,
  SanitizedInteractionEvent,
  SanitizedRecordingSession,
} from './sanitized';

const textEncoder = new TextEncoder();
export const MAX_SESSION_WARNINGS = 100;
export const MAX_SESSION_INTERACTIONS = 1_000;
const trustedSessions = new WeakSet<object>();

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateSessionLimits(limits: SessionLimits): SessionLimits {
  if (
    !isPositiveInteger(limits.maxRequests) ||
    !isPositiveInteger(limits.maxBytes) ||
    !isPositiveInteger(limits.maxBodyBytes) ||
    limits.maxBodyBytes > limits.maxBytes
  ) {
    throw new RangeError(
      'Session limits must be finite positive integers within maxBytes.',
    );
  }
  return limits;
}

function serializeRequest(request: SanitizedCapturedRequest): string {
  const serialized = JSON.stringify(request);
  if (serialized === undefined) {
    throw new TypeError('Captured request is not serializable.');
  }
  return serialized;
}

export function calculateRequestBytes(request: SanitizedCapturedRequest): number {
  return textEncoder.encode(serializeRequest(request)).byteLength;
}

function assertDenseArray(value: readonly unknown[], name: string): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${name} must not contain sparse entries.`);
    }
  }
}

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return value;
  }
  visited.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, visited);
  }
  return Object.freeze(value);
}

export function freezeSession(
  session: SanitizedRecordingSession,
): SanitizedRecordingSession {
  if (trustedSessions.has(session)) {
    return session;
  }
  validateSessionLimits(session.limits);
  assertDenseArray(session.requests, 'requests');
  assertDenseArray(session.interactions, 'interactions');
  assertDenseArray(session.warnings, 'warnings');
  if (session.requests.length > session.limits.maxRequests) {
    throw new RangeError('Session request count exceeds maxRequests.');
  }
  const requestBytes: number[] = [];
  let byteCount = 0;
  for (const request of session.requests) {
    const bytes = calculateRequestBytes(request);
    byteCount += bytes;
    if (byteCount > session.limits.maxBytes) {
      throw new RangeError('Session request bytes exceed maxBytes.');
    }
    requestBytes.push(bytes);
  }
  return cloneAndFreeze(session, requestBytes, byteCount);
}

function cloneAndFreeze(
  session: SanitizedRecordingSession,
  requestBytes: readonly number[],
  byteCount: number,
): SanitizedRecordingSession {
  const clone = structuredClone({
    ...session,
    requests: [...session.requests],
    requestBytes: [...requestBytes],
    byteCount,
    interactions: [...session.interactions],
    warnings: [...session.warnings].slice(-MAX_SESSION_WARNINGS),
  });
  const frozen = deepFreeze(clone);
  trustedSessions.add(frozen);
  return frozen;
}

/**
 * Appends a sanitized interaction event within a fixed bound so a noisy page
 * cannot grow the session without limit. Byte accounting is unchanged because
 * interaction events are not part of the request byte budget.
 */
export function addInteractionBounded(
  session: SanitizedRecordingSession,
  interaction: SanitizedInteractionEvent,
): SanitizedRecordingSession {
  const normalized = trustedSessions.has(session) ? session : freezeSession(session);
  return cloneAndFreeze(
    {
      ...normalized,
      interactions: [...normalized.interactions, interaction].slice(
        -MAX_SESSION_INTERACTIONS,
      ),
    },
    normalized.requestBytes,
    normalized.byteCount,
  );
}

function appendWarning(
  session: SanitizedRecordingSession,
  warning: SessionWarning,
): SanitizedRecordingSession {
  return cloneAndFreeze(
    {
      ...session,
      warnings: [...session.warnings, warning],
    },
    session.requestBytes,
    session.byteCount,
  );
}

export function addBounded(
  session: SanitizedRecordingSession,
  request: SanitizedCapturedRequest,
): SanitizedRecordingSession {
  validateSessionLimits(session.limits);
  const normalized = trustedSessions.has(session) ? session : freezeSession(session);
  let serialized: string;
  let requestBytes: number;
  try {
    serialized = serializeRequest(request);
    requestBytes = textEncoder.encode(serialized).byteLength;
  } catch {
    return appendWarning(normalized, {
      code: 'request-too-large',
      message: 'Request could not be stored as bounded serialized evidence.',
      requestId: request.id,
    });
  }

  if (requestBytes > normalized.limits.maxBytes) {
    return appendWarning(normalized, {
      code: 'request-too-large',
      message: `Request exceeds the ${normalized.limits.maxBytes}-byte session limit.`,
      requestId: request.id,
    });
  }

  const clonedRequest = JSON.parse(serialized) as SanitizedCapturedRequest;
  const requests = [...normalized.requests, clonedRequest];
  const sizes = [...normalized.requestBytes, requestBytes];
  let byteCount = normalized.byteCount + requestBytes;
  let firstKept = 0;

  while (
    requests.length - firstKept > normalized.limits.maxRequests ||
    byteCount > normalized.limits.maxBytes
  ) {
    byteCount -= sizes[firstKept]!;
    firstKept += 1;
  }

  const keptSizes = sizes.slice(firstKept);
  return cloneAndFreeze(
    {
      ...normalized,
      requests: requests.slice(firstKept),
      requestBytes: keptSizes,
      byteCount,
      evictedCount: normalized.evictedCount + firstKept,
    },
    keptSizes,
    byteCount,
  );
}
