import type {
  BodyContent,
  CapturedRequest,
  Classification,
  ElementDescriptor,
  Explanation,
  InteractionEvent,
  RequestTiming,
  RecordingPhase,
  RecordingSession,
  RetentionMode,
  SessionLimits,
  SessionWarning,
  SessionWarningCode,
} from '../../domain/model';
import type { SanitizedRecordingSession } from '../../domain/sanitized';
import {
  freezeSession,
  MAX_SESSION_WARNINGS,
  validateSessionLimits,
} from '../../domain/ring-buffer';
import {
  redactRecoveredSession,
  redactSession,
  redactUnknown,
  REDACTED,
} from '../../domain/redaction';
import { DEFAULT_LIMITS } from '../../domain/session';
import { DEFAULT_REDACTION_CONFIG } from '../../features/settings/redaction-settings';

export const STORAGE_SCHEMA_VERSION = 1;
export const MAX_STORAGE_BYTES = 10 * 1024 * 1024;
export const MAX_STORED_REQUESTS = 10_000;
const MAX_INTERACTIONS = 10_000;
const MAX_VALIDATION_DEPTH = 32;
const MAX_VALIDATION_NODES = 100_000;
const MAX_OBJECT_KEYS = 64;
const MAX_STRING_LENGTH = 1024 * 1024;
const MAX_DESCRIPTOR_CODE_POINTS = 80;
const MAX_TAG_CODE_POINTS = 32;
const MAX_INTERACTION_ID_CODE_POINTS = 128;
const MAX_INTERACTION_URL_CODE_UNITS = 8_192;

export type StoredSession = Readonly<{
  version: typeof STORAGE_SCHEMA_VERSION;
  session: SanitizedRecordingSession;
}>;

export type StoredSessionLocator = Readonly<{
  version: typeof STORAGE_SCHEMA_VERSION;
  tabId: string;
  sessionId: string;
}>;

const phases = new Set<RecordingPhase>([
  'stopped',
  'starting',
  'recording',
  'stopping',
]);
const retentions = new Set<RetentionMode>(['ephemeral', 'persistent']);
const warningCodes = new Set<SessionWarningCode>([
  'classification-failed',
  'content-api-unavailable',
  'content-callback-timeout',
  'explanation-failed',
  'har-api-unavailable',
  'har-callback-timeout',
  'invalid-content-encoding',
  'invalid-har',
  'invalid-started-time',
  'interaction-start-failed',
  'normalization-failed',
  'redaction-failed',
  'sink-failed',
  'capture-failed',
  'corrupt-session',
  'migration-cleanup-failed',
  'migration-failed',
  'persistence-disabled',
  'request-too-large',
]);

type ValidationBudget = {
  nodes: number;
  characters: number;
  seen: WeakSet<object>;
};

type PlainDataResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;

const invalidPlainData: PlainDataResult = { ok: false };

function clonePlainData(
  value: unknown,
  budget: ValidationBudget,
  depth = 0,
): PlainDataResult {
  budget.nodes += 1;
  if (budget.nodes > MAX_VALIDATION_NODES || depth > MAX_VALIDATION_DEPTH) {
    return invalidPlainData;
  }
  if (typeof value === 'string') {
    budget.characters += value.length;
    return value.length <= MAX_STRING_LENGTH && budget.characters <= MAX_STORAGE_BYTES
      ? { ok: true, value }
      : invalidPlainData;
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return { ok: true, value };
  }
  if (typeof value !== 'object' || budget.seen.has(value)) {
    return invalidPlainData;
  }
  budget.seen.add(value);

  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return invalidPlainData;
  }

  const names = Object.getOwnPropertyNames(value);
  if (isArray) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_STORED_REQUESTS ||
      names.length !== length + 1
    ) {
      return invalidPlainData;
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        !descriptor.enumerable
      ) {
        return invalidPlainData;
      }
      const child = clonePlainData(descriptor.value, budget, depth + 1);
      if (!child.ok) {
        return invalidPlainData;
      }
      clone.push(child.value);
    }
    return { ok: true, value: clone };
  }

  if (names.length > MAX_OBJECT_KEYS) {
    return invalidPlainData;
  }
  const clone: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      name.length > 128 ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      !descriptor.enumerable
    ) {
      return invalidPlainData;
    }
    const child = clonePlainData(descriptor.value, budget, depth + 1);
    if (!child.ok) {
      return invalidPlainData;
    }
    Object.defineProperty(clone, name, {
      value: child.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ok: true, value: clone };
}

function cloneSafePlainData(value: unknown): PlainDataResult {
  try {
    return clonePlainData(value, {
      nodes: 0,
      characters: 0,
      seen: new WeakSet<object>(),
    });
  } catch {
    return invalidPlainData;
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isHeaderArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (header) =>
        isRecord(header) &&
        hasOnlyKeys(header, ['name', 'value']) &&
        isString(header.name) &&
        isString(header.value),
    )
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalDuration(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0);
}

function isBody(value: unknown): value is BodyContent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'state',
      'size',
      'capturedSize',
      'text',
      'mimeType',
      'reason',
    ]) ||
    !['available', 'unavailable', 'truncated', 'binary', 'streamed'].includes(
      String(value.state),
    ) ||
    !isFiniteNumber(value.size) ||
    value.size < 0 ||
    !isFiniteNumber(value.capturedSize) ||
    value.capturedSize < 0 ||
    value.capturedSize > value.size
  ) {
    return false;
  }
  return (
    isOptionalString(value.text) &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.reason)
  );
}

function isTiming(value: unknown): value is RequestTiming {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'totalMs',
      'blockedMs',
      'dnsMs',
      'connectMs',
      'sslMs',
      'sendMs',
      'waitMs',
      'receiveMs',
    ]) &&
    isFiniteNumber(value.totalMs) &&
    value.totalMs >= 0 &&
    isOptionalDuration(value.blockedMs) &&
    isOptionalDuration(value.dnsMs) &&
    isOptionalDuration(value.connectMs) &&
    isOptionalDuration(value.sslMs) &&
    isOptionalDuration(value.sendMs) &&
    isOptionalDuration(value.waitMs) &&
    isOptionalDuration(value.receiveMs)
  );
}

function isClassification(value: unknown): value is Classification {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['kind', 'confidence', 'evidence', 'actionId']) &&
    isString(value.kind) &&
    ['confirmed', 'likely', 'unknown'].includes(String(value.confidence)) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isString) &&
    isOptionalString(value.actionId)
  );
}

function isExplanation(value: unknown): value is Explanation {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['outcome', 'summary', 'guidance', 'evidence']) &&
    isString(value.outcome) &&
    isString(value.summary) &&
    Array.isArray(value.guidance) &&
    value.guidance.every(isString) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isString)
  );
}

function isCapturedRequest(value: unknown): value is CapturedRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'url',
      'method',
      'startedAt',
      'request',
      'response',
      'timing',
      'evidence',
      'classification',
      'explanation',
    ]) ||
    !isString(value.id) ||
    !isString(value.url) ||
    !isString(value.method) ||
    !isFiniteNumber(value.startedAt) ||
    !isRecord(value.request) ||
    !hasOnlyKeys(value.request, ['headers', 'body']) ||
    !isHeaderArray(value.request.headers) ||
    (value.request.body !== undefined && !isBody(value.request.body)) ||
    !isRecord(value.response) ||
    !hasOnlyKeys(value.response, ['status', 'statusText', 'headers', 'body']) ||
    !isFiniteNumber(value.response.status) ||
    !isOptionalString(value.response.statusText) ||
    !isHeaderArray(value.response.headers) ||
    !isBody(value.response.body) ||
    !isTiming(value.timing) ||
    !isRecord(value.evidence) ||
    !hasOnlyKeys(value.evidence, [
      'fromCache',
      'fromServiceWorker',
      'redirectUrl',
      'redirectParentId',
      'initiator',
    ]) ||
    !isOptionalBoolean(value.evidence.fromCache) ||
    !isOptionalBoolean(value.evidence.fromServiceWorker) ||
    !isOptionalString(value.evidence.redirectUrl) ||
    !isOptionalString(value.evidence.redirectParentId) ||
    !isOptionalString(value.evidence.initiator) ||
    (value.classification !== undefined && !isClassification(value.classification)) ||
    (value.explanation !== undefined && !isExplanation(value.explanation))
  ) {
    return false;
  }
  return true;
}

function boundedCodePoints(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length > maximum * 2) {
    return false;
  }
  let count = 0;
  for (const codePoint of value) {
    void codePoint;
    count += 1;
    if (count > maximum) {
      return false;
    }
  }
  return true;
}

function isCanonicalDescriptorValue(value: unknown): value is string {
  return (
    boundedCodePoints(value, MAX_DESCRIPTOR_CODE_POINTS) &&
    value !== '' &&
    value.replace(/\s+/gu, ' ').trim() === value &&
    value !== REDACTED &&
    redactUnknown(value, DEFAULT_REDACTION_CONFIG) === value
  );
}

function isElementDescriptor(value: unknown): value is ElementDescriptor {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['tag', 'role', 'name', 'id', 'text']) ||
    !boundedCodePoints(value.tag, MAX_TAG_CODE_POINTS) ||
    !/^[a-z][a-z0-9-]*$/u.test(value.tag)
  ) {
    return false;
  }
  return (['role', 'name', 'id', 'text'] as const).every(
    (key) => value[key] === undefined || isCanonicalDescriptorValue(value[key]),
  );
}

function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_INTERACTION_URL_CODE_UNITS) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function isSameSessionPageUrl(value: unknown, origin: string): value is string {
  if (typeof value !== 'string' || value.length > MAX_INTERACTION_URL_CODE_UNITS) {
    return false;
  }
  try {
    const url = new URL(value);
    const canonical = `${url.origin}${url.pathname}`;
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      (value === canonical || (url.pathname === '/' && value === url.origin))
    );
  } catch {
    return false;
  }
}

function isInteraction(
  value: unknown,
  sessionOrigin: string,
  sessionTabId: string,
): value is InteractionEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'tabId',
      'kind',
      'occurredAt',
      'trust',
      'target',
      'url',
    ]) ||
    !boundedCodePoints(value.id, MAX_INTERACTION_ID_CODE_POINTS) ||
    value.id === '' ||
    value.tabId !== sessionTabId ||
    typeof value.kind !== 'string' ||
    !['click', 'submit', 'navigation', 'history'].includes(value.kind) ||
    !isFiniteNumber(value.occurredAt)
  ) {
    return false;
  }
  const kind = value.kind as InteractionEvent['kind'];
  if (
    (kind === 'history' && value.trust !== 'untrusted-hint') ||
    (kind !== 'history' && value.trust !== 'trusted') ||
    (value.target !== undefined && !isElementDescriptor(value.target)) ||
    ((kind === 'navigation' || kind === 'history') && value.target !== undefined) ||
    (value.url !== undefined && !isSameSessionPageUrl(value.url, sessionOrigin))
  ) {
    return false;
  }
  return true;
}

function isLimits(value: unknown): value is SessionLimits {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['maxRequests', 'maxBytes', 'maxBodyBytes'])
  ) {
    return false;
  }
  try {
    validateSessionLimits(value as SessionLimits);
  } catch {
    return false;
  }
  return (
    (value.maxRequests as number) <= MAX_STORED_REQUESTS &&
    (value.maxBytes as number) <= MAX_STORAGE_BYTES
  );
}

function isWarning(value: unknown): value is SessionWarning {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['code', 'message', 'requestId']) &&
    warningCodes.has(value.code as SessionWarningCode) &&
    isString(value.message) &&
    (value.requestId === undefined || isString(value.requestId))
  );
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Stored session is not serializable.');
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function parseSession(
  value: unknown,
  expectedSessionId: string,
): SanitizedRecordingSession | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'tabId',
      'origin',
      'phase',
      'retention',
      'limits',
      'startedAt',
      'stoppedAt',
      'requests',
      'requestBytes',
      'byteCount',
      'interactions',
      'evictedCount',
      'warnings',
    ]) ||
    value.id !== expectedSessionId ||
    !isString(value.tabId) ||
    !isCanonicalOrigin(value.origin) ||
    !phases.has(value.phase as RecordingPhase) ||
    !retentions.has(value.retention as RetentionMode) ||
    !isLimits(value.limits) ||
    !isNullableTimestamp(value.startedAt) ||
    !isNullableTimestamp(value.stoppedAt) ||
    !Array.isArray(value.requests) ||
    value.requests.length > (value.limits as SessionLimits).maxRequests ||
    value.requests.length > MAX_STORED_REQUESTS ||
    !value.requests.every(isCapturedRequest) ||
    !Array.isArray(value.requestBytes) ||
    value.requestBytes.length !== value.requests.length ||
    !value.requestBytes.every(
      (bytes) => Number.isSafeInteger(bytes) && (bytes as number) >= 0,
    ) ||
    !Number.isSafeInteger(value.byteCount) ||
    (value.byteCount as number) < 0 ||
    !Array.isArray(value.interactions) ||
    value.interactions.length > MAX_INTERACTIONS ||
    !value.interactions.every((interaction) =>
      isInteraction(interaction, value.origin as string, value.tabId as string),
    ) ||
    !Number.isSafeInteger(value.evictedCount) ||
    (value.evictedCount as number) < 0 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > MAX_SESSION_WARNINGS ||
    !value.warnings.every(isWarning)
  ) {
    return null;
  }

  const rawRequestBytes = (value.requests as CapturedRequest[]).map((request) =>
    serializedBytes(request),
  );
  if (
    rawRequestBytes.some(
      (bytes, index) => bytes !== (value.requestBytes as number[])[index],
    ) ||
    rawRequestBytes.reduce((total, bytes) => total + bytes, 0) !== value.byteCount
  ) {
    return null;
  }

  let normalized: SanitizedRecordingSession;
  try {
    normalized = freezeSession(
      redactRecoveredSession(value as RecordingSession, DEFAULT_REDACTION_CONFIG),
    );
  } catch {
    return null;
  }
  return normalized;
}

export function createCorruptSession(
  sessionId: string,
  tabId = '',
): SanitizedRecordingSession {
  return freezeSession(
    redactSession(
      {
        id: sessionId,
        tabId,
        origin: '',
        phase: 'stopped',
        retention: 'ephemeral',
        limits: DEFAULT_LIMITS,
        startedAt: null,
        stoppedAt: null,
        requests: [],
        requestBytes: [],
        byteCount: 0,
        interactions: [],
        evictedCount: 0,
        warnings: [
          {
            code: 'corrupt-session',
            message:
              'Stored session could not be validated. Original local evidence was retained.',
          },
        ],
      },
      DEFAULT_REDACTION_CONFIG,
    ),
  );
}

export function encodeStoredSession(session: SanitizedRecordingSession): StoredSession {
  const frozen = freezeSession(session);
  const stored = {
    version: STORAGE_SCHEMA_VERSION,
    session: frozen,
  } as const;
  if (serializedBytes(stored) > MAX_STORAGE_BYTES) {
    throw new RangeError('Serialized session exceeds the local storage safety cap.');
  }
  return structuredClone(stored);
}

export function decodeStoredSession(
  value: unknown,
  sessionId: string,
  recoveryTabId = '',
): SanitizedRecordingSession {
  try {
    const cloned = cloneSafePlainData(value);
    if (
      !cloned.ok ||
      !isRecord(cloned.value) ||
      !hasOnlyKeys(cloned.value, ['version', 'session']) ||
      serializedBytes(cloned.value) > MAX_STORAGE_BYTES ||
      cloned.value.version !== STORAGE_SCHEMA_VERSION
    ) {
      return createCorruptSession(sessionId, recoveryTabId);
    }
    return (
      parseSession(cloned.value.session, sessionId) ??
      createCorruptSession(sessionId, recoveryTabId)
    );
  } catch {
    return createCorruptSession(sessionId, recoveryTabId);
  }
}

export function encodeSessionLocator(
  session: Pick<RecordingSession, 'id' | 'tabId'>,
): StoredSessionLocator {
  return {
    version: STORAGE_SCHEMA_VERSION,
    tabId: session.tabId,
    sessionId: session.id,
  };
}

export function decodeSessionLocator(
  value: unknown,
  expectedTabId: string,
): StoredSessionLocator | null {
  const cloned = cloneSafePlainData(value);
  if (
    !cloned.ok ||
    !isRecord(cloned.value) ||
    !hasOnlyKeys(cloned.value, ['version', 'tabId', 'sessionId']) ||
    cloned.value.version !== STORAGE_SCHEMA_VERSION ||
    cloned.value.tabId !== expectedTabId ||
    !isString(cloned.value.sessionId)
  ) {
    return null;
  }
  return cloned.value as StoredSessionLocator;
}
