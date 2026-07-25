import type { BodyContent, CapturedRequest, Header } from './model';
import { parseMultipartBody } from './multipart';
import {
  DEFAULT_REDACTION_CONFIG,
  type RedactionConfig,
} from '../features/settings/redaction-settings';

export {
  DEFAULT_REDACTION_CONFIG,
  type RedactionConfig,
} from '../features/settings/redaction-settings';

export const REDACTED = '[REDACTED]' as const;

const MAX_DEPTH = 32;
const MAX_KEYS = 10_000;
const MAX_PATTERN_SCAN_CHARACTERS = 1024 * 1024;
const MAX_JWT_SEGMENT_CHARACTERS = 64 * 1024;

const AUTHORIZATION_HEADER_NAMES = new Set(['authorization', 'proxyauthorization']);
const COOKIE_HEADER_NAMES = new Set(['cookie', 'setcookie']);
const ALWAYS_SENSITIVE_NAME_WORDS = new Set([
  'password',
  'passwd',
  'passphrase',
  'token',
  'secret',
  'credential',
  'credentials',
  'csrf',
  'xsrf',
]);
const SESSION_CREDENTIAL_WORDS = new Set(['id', 'token', 'key', 'secret', 'cookie']);
const NORMALIZED_CREDENTIAL_SUFFIXES = [
  'password',
  'passwd',
  'passphrase',
  'token',
  'secret',
  'apikey',
  'sessionid',
  'credential',
  'credentials',
  'csrf',
  'xsrf',
] as const;
const NORMALIZED_SESSION_CREDENTIAL_SUFFIXES = [
  'sessionid',
  'sessiontoken',
  'sessionkey',
  'sessionsecret',
  'sessioncookie',
] as const;

const VALUE_PATTERNS = [
  /\bbearer[ \t]+[A-Za-z0-9._~+/-]+={0,2}/iu,
  /\b(?:sk|pk)[_-](?:live|test|proj)[_-][A-Za-z0-9_-]+\b/iu,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/iu,
  /\b(?:api[_ -]?key|token|secret)[ \t]*[:=][ \t]*[^\s,;&]+/iu,
] as const;
const JWT_CANDIDATE_PATTERN =
  /(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]*)(?=$|[^A-Za-z0-9_-])/gu;

type TraversalContext = {
  readonly fieldNames: ReadonlySet<string>;
  readonly scanValuePatterns: boolean;
  readonly seen: WeakSet<object>;
  keys: number;
};

function readDataProperty(input: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function ownPropertyDescriptors(input: object): PropertyDescriptorMap | undefined {
  try {
    return Object.getOwnPropertyDescriptors(input);
  } catch {
    return undefined;
  }
}

type DataContainerKind = 'array' | 'record';

function dataContainerKind(input: object): DataContainerKind | undefined {
  try {
    if (Array.isArray(input)) return 'array';
    const prototype: unknown = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null ? 'record' : undefined;
  } catch {
    return undefined;
  }
}

function defineDataProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function fieldNameWords(fieldName: string): readonly string[] {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);
}

function isBuiltInSensitiveName(fieldName: string): boolean {
  const words = fieldNameWords(fieldName);
  if (words.some((word) => ALWAYS_SENSITIVE_NAME_WORDS.has(word))) return true;
  if (words.some((word, index) => word === 'api' && words[index + 1] === 'key')) {
    return true;
  }

  const sessionIndex = words.indexOf('session');
  if (sessionIndex < 0) return false;
  return (
    SESSION_CREDENTIAL_WORDS.has(words[sessionIndex - 1] ?? '') ||
    SESSION_CREDENTIAL_WORDS.has(words[sessionIndex + 1] ?? '')
  );
}

function configuredFieldNames(config: RedactionConfig): ReadonlySet<string> {
  const configured = readDataProperty(config, 'fieldNames');
  const source =
    configured !== null && typeof configured === 'object'
      ? configured
      : DEFAULT_REDACTION_CONFIG.fieldNames;
  const names = new Set<string>();
  const descriptors =
    ownPropertyDescriptors(source) ??
    Object.getOwnPropertyDescriptors(DEFAULT_REDACTION_CONFIG.fieldNames);

  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue;
    if (typeof descriptor.value === 'string') {
      names.add(normalizeFieldName(descriptor.value));
    }
  }

  for (const defaultName of DEFAULT_REDACTION_CONFIG.fieldNames) {
    names.add(normalizeFieldName(defaultName));
  }
  return names;
}

function traversalContext(config: RedactionConfig): TraversalContext {
  const scanValuePatterns = readDataProperty(config, 'scanValuePatterns');
  return {
    fieldNames: configuredFieldNames(config),
    scanValuePatterns: scanValuePatterns !== false,
    seen: new WeakSet<object>(),
    keys: 0,
  };
}

function isSensitiveField(fieldName: string, context: TraversalContext): boolean {
  const normalized = normalizeFieldName(fieldName);
  return (
    context.fieldNames.has(normalized) ||
    NORMALIZED_CREDENTIAL_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    NORMALIZED_SESSION_CREDENTIAL_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    ) ||
    isBuiltInSensitiveName(fieldName)
  );
}

function decodeJwtSegment(segment: string): unknown {
  if (
    segment.length === 0 ||
    segment.length > MAX_JWT_SEGMENT_CHARACTERS ||
    segment.length % 4 === 1
  ) {
    return undefined;
  }

  try {
    const base64 = segment
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function containsValidatedJwt(value: string): boolean {
  JWT_CANDIDATE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(JWT_CANDIDATE_PATTERN)) {
    const header = decodeJwtSegment(match[1]!);
    const payload = decodeJwtSegment(match[2]!);
    if (
      header !== null &&
      typeof header === 'object' &&
      typeof readDataProperty(header, 'alg') === 'string' &&
      payload !== null &&
      typeof payload === 'object'
    ) {
      return true;
    }
  }
  return false;
}

function redactValuePatterns(value: string, context: TraversalContext): string {
  if (!context.scanValuePatterns) return value;
  if (value.length > MAX_PATTERN_SCAN_CHARACTERS) return REDACTED;
  return VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
    containsValidatedJwt(value)
    ? REDACTED
    : value;
}

function redactUnknownWithContext(
  value: unknown,
  context: TraversalContext,
  depth: number,
  fieldName?: string,
): unknown {
  if (fieldName !== undefined && isSensitiveField(fieldName, context)) {
    return REDACTED;
  }
  if (typeof value === 'string') return redactValuePatterns(value, context);
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') return REDACTED;
  if (depth >= MAX_DEPTH || context.seen.has(value)) return REDACTED;

  context.seen.add(value);
  const containerKind = dataContainerKind(value);
  if (containerKind === undefined) return REDACTED;
  const output: unknown[] | Record<string, unknown> =
    containerKind === 'array' ? [] : Object.create(null);
  const descriptors = ownPropertyDescriptors(value);
  if (descriptors === undefined) return REDACTED;

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (context.keys >= MAX_KEYS) break;
    context.keys += 1;

    if (!('value' in descriptor)) {
      if (isSensitiveField(key, context)) {
        defineDataProperty(output, key, REDACTED);
      }
      continue;
    }

    defineDataProperty(
      output,
      key,
      redactUnknownWithContext(descriptor.value, context, depth + 1, key),
    );
  }

  return output;
}

function redactTrustedDto(value: unknown, config: RedactionConfig): unknown {
  try {
    return redactUnknownWithContext(value, traversalContext(config), 0);
  } catch {
    return REDACTED;
  }
}

/**
 * Untrusted-value boundary. Object inputs are rejected without reflection;
 * structural traversal is reserved for internally normalized typed DTOs.
 */
export function redactUnknown(value: unknown, config: RedactionConfig): unknown {
  if (value !== null && typeof value === 'object') return REDACTED;
  return redactTrustedDto(value, config);
}

function redactQueryParameters(
  parameters: URLSearchParams,
  context: TraversalContext,
): URLSearchParams {
  const redacted = new URLSearchParams();
  for (const [name, value] of parameters) {
    redacted.append(
      name,
      isSensitiveField(name, context) ? REDACTED : redactValuePatterns(value, context),
    );
  }
  return redacted;
}

function exposeRedactedMarkers(value: string): string {
  return value.replaceAll('%5BREDACTED%5D', REDACTED);
}

export function redactUrl(input: string, config: RedactionConfig): string {
  try {
    const context = traversalContext(config);
    const url = new URL(input, 'https://payloadra.invalid');
    const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(input) || input.startsWith('//');
    if (url.username !== '') url.username = REDACTED;
    if (url.password !== '') url.password = REDACTED;
    url.search = redactQueryParameters(url.searchParams, context).toString();
    const formatted = absolute
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`;
    return exposeRedactedMarkers(formatted);
  } catch {
    return REDACTED;
  }
}

function redactionFailedBody(): BodyContent {
  return {
    state: 'unavailable',
    size: 0,
    capturedSize: 0,
    reason: 'redaction-failed',
  };
}

export function redactHeaders(
  headers: readonly Header[],
  config: RedactionConfig,
): readonly Header[] {
  const context = traversalContext(config);
  const output: Header[] = [];
  const descriptors = ownPropertyDescriptors(headers);
  if (descriptors === undefined) return output;

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === 'length' || !descriptor.enumerable || !('value' in descriptor)) {
      continue;
    }
    if (output.length >= MAX_KEYS) break;
    const header = descriptor.value;
    if (header === null || typeof header !== 'object') continue;
    const name = readDataProperty(header, 'name');
    const value = readDataProperty(header, 'value');
    if (typeof name !== 'string' || typeof value !== 'string') continue;

    const normalizedName = normalizeFieldName(name);
    const sensitive =
      AUTHORIZATION_HEADER_NAMES.has(normalizedName) ||
      COOKIE_HEADER_NAMES.has(normalizedName) ||
      isSensitiveField(name, context);
    output.push({
      name,
      value: sensitive ? REDACTED : redactValuePatterns(value, context),
    });
  }

  return output;
}

function contentType(mimeType: string): string {
  return mimeType.split(';', 1)[0]!.trim().toLowerCase();
}

function redactJsonText(text: string, config: RedactionConfig): string {
  try {
    const parsed: unknown = JSON.parse(text);
    return JSON.stringify(redactTrustedDto(parsed, config));
  } catch {
    return REDACTED;
  }
}

function redactFormText(text: string, context: TraversalContext): string {
  const output = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(text)) {
    output.append(
      name,
      isSensitiveField(name, context) ? REDACTED : redactValuePatterns(value, context),
    );
  }
  return exposeRedactedMarkers(output.toString());
}

function redactMultipartText(
  text: string,
  mimeType: string,
  context: TraversalContext,
): string {
  const multipart = parseMultipartBody(text, mimeType);
  if (multipart === undefined) return REDACTED;

  const delimiter = `--${multipart.boundary}`;
  const parts = multipart.parts.map((part) => {
    const safeName = /^[A-Za-z0-9_.-]+$/u.test(part.name)
      ? part.name
      : JSON.stringify(part.name);
    const safeDisposition =
      `Content-Disposition: form-data; name=${safeName}` +
      (part.filename === undefined ? '' : `; filename="${REDACTED}"`);
    const value =
      part.filename !== undefined || isSensitiveField(part.name, context)
        ? REDACTED
        : redactValuePatterns(part.value, context);
    return `${delimiter}${multipart.lineEnding}${safeDisposition}${multipart.lineEnding}${multipart.lineEnding}${value}${multipart.lineEnding}`;
  });

  return `${parts.join('')}${delimiter}--`;
}

function redactBodyText(
  text: string,
  mimeType: string,
  config: RedactionConfig,
): string {
  const context = traversalContext(config);
  if (text.length > MAX_PATTERN_SCAN_CHARACTERS) return REDACTED;

  const mime = contentType(mimeType);
  if (mime === 'application/json' || mime.endsWith('+json')) {
    return redactJsonText(text, config);
  }
  if (mime === 'application/x-www-form-urlencoded') {
    return redactFormText(text, context);
  }
  if (mime === 'multipart/form-data') {
    return redactMultipartText(text, mimeType, context);
  }
  return redactValuePatterns(text, context);
}

/**
 * Trusted DTO boundary. `body` must come from Payloadra normalization, not an
 * arbitrary page object or Proxy. Violations fail closed, but JavaScript Proxy
 * reflection can execute traps before reporting failure.
 */
export function redactBody(body: BodyContent, config: RedactionConfig): BodyContent {
  try {
    const output = redactTrustedDto(body, config);
    if (output === null || typeof output !== 'object') {
      return redactionFailedBody();
    }

    const text = readDataProperty(body, 'text');
    const mimeType = readDataProperty(body, 'mimeType');
    if (typeof text === 'string') {
      defineDataProperty(
        output,
        'text',
        redactBodyText(
          text,
          typeof mimeType === 'string' ? mimeType : 'text/plain',
          config,
        ),
      );
    }
    return output as BodyContent;
  } catch {
    return redactionFailedBody();
  }
}

function redactNestedRequestData(
  source: unknown,
  target: unknown,
  config: RedactionConfig,
): void {
  if (
    source === null ||
    typeof source !== 'object' ||
    target === null ||
    typeof target !== 'object'
  ) {
    return;
  }

  const headers = readDataProperty(source, 'headers');
  if (
    headers !== null &&
    typeof headers === 'object' &&
    dataContainerKind(headers) === 'array'
  ) {
    defineDataProperty(
      target,
      'headers',
      redactHeaders(headers as readonly Header[], config),
    );
  }
  const body = readDataProperty(source, 'body');
  if (body !== null && typeof body === 'object') {
    defineDataProperty(target, 'body', redactBody(body as BodyContent, config));
  }
}

function redactionFailedRequest(): CapturedRequest {
  return {
    id: REDACTED,
    url: REDACTED,
    method: 'UNKNOWN',
    startedAt: 0,
    request: { headers: [] },
    response: {
      status: 0,
      headers: [],
      body: redactionFailedBody(),
    },
    timing: { totalMs: 0 },
    evidence: {},
  };
}

/**
 * Trusted DTO boundary. `request` must be an internally normalized
 * `CapturedRequest`; arbitrary objects use `redactUnknown` and fail closed.
 * The outer catch protects contract violations, but cannot undo Proxy traps
 * already executed by JavaScript reflection.
 */
export function redactRequest(
  request: CapturedRequest,
  config: RedactionConfig,
): CapturedRequest {
  try {
    const output = redactTrustedDto(request, config);
    if (output === null || typeof output !== 'object') {
      return redactionFailedRequest();
    }

    const url = readDataProperty(request, 'url');
    if (typeof url === 'string') {
      defineDataProperty(output, 'url', redactUrl(url, config));
    }

    const requestSource = readDataProperty(request, 'request');
    const requestTarget = readDataProperty(output, 'request');
    redactNestedRequestData(requestSource, requestTarget, config);

    const responseSource = readDataProperty(request, 'response');
    const responseTarget = readDataProperty(output, 'response');
    redactNestedRequestData(responseSource, responseTarget, config);

    return output as CapturedRequest;
  } catch {
    return redactionFailedRequest();
  }
}
