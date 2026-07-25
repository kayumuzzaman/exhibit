import { parseMultipartBody } from './multipart';

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_KEYS = 10_000;
const MAX_INSPECTED_CODE_UNITS = DEFAULT_MAX_BYTES + 1;

export type DecodedField = Readonly<{
  name: string;
  value: string;
}>;

export type DecodedBodyKind = 'json' | 'form' | 'multipart' | 'text';

export type DecodedBodyIssue =
  'malformed' | 'maximum-depth-exceeded' | 'maximum-keys-exceeded';

export type DecodedBody = Readonly<{
  kind: DecodedBodyKind;
  text: string;
  value?: unknown;
  fields?: readonly DecodedField[];
  originalBytes: number;
  originalBytesExact: boolean;
  capturedBytes: number;
  truncated: boolean;
  issue?: DecodedBodyIssue;
}>;

export type DecodeTextBodyInput = Readonly<{
  text: string;
  mimeType?: string;
  maxBytes?: number;
  maxDepth?: number;
}>;

type BoundedText = Readonly<{
  text: string;
  originalBytes: number;
  originalBytesExact: boolean;
  capturedBytes: number;
  truncated: boolean;
}>;

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

function finiteLimit(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), maximum)
    : fallback;
}

function utf8Width(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function boundUtf8(text: string, maxBytes: number): BoundedText {
  let originalBytes = 0;
  let capturedBytes = 0;
  let accepting = true;
  const captured: string[] = [];
  const inspectedCodeUnits = Math.min(text.length, MAX_INSPECTED_CODE_UNITS);
  let consumedCodeUnits = 0;

  for (let index = 0; index < inspectedCodeUnits;) {
    const codePoint = text.codePointAt(index)!;
    const width = utf8Width(codePoint);
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    originalBytes += width;
    consumedCodeUnits = index + codeUnits;

    if (accepting && capturedBytes + width <= maxBytes) {
      captured.push(String.fromCodePoint(codePoint));
      capturedBytes += width;
    } else {
      accepting = false;
    }

    index = consumedCodeUnits;
  }

  const fullyInspected = consumedCodeUnits === text.length;
  const reportedOriginalBytes = fullyInspected
    ? originalBytes
    : Math.max(originalBytes + 1, text.length);

  return {
    text: captured.join(''),
    originalBytes: reportedOriginalBytes,
    originalBytesExact: fullyInspected,
    capturedBytes,
    truncated: !fullyInspected || capturedBytes < originalBytes,
  };
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]!.trim().toLowerCase();
}

function inspectStructure(
  value: unknown,
  maxDepth: number,
): DecodedBodyIssue | undefined {
  const stack: Array<Readonly<{ value: unknown; depth: number }>> = [
    { value, depth: 0 },
  ];
  let keys = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) return 'maximum-depth-exceeded';
    if (current.value === null || typeof current.value !== 'object') continue;

    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) continue;
      keys += 1;
      if (keys > DEFAULT_MAX_KEYS) return 'maximum-keys-exceeded';
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }

  return undefined;
}

function textResult(bounded: BoundedText, issue?: DecodedBodyIssue): DecodedBody {
  return {
    kind: 'text',
    text: bounded.text,
    originalBytes: bounded.originalBytes,
    originalBytesExact: bounded.originalBytesExact,
    capturedBytes: bounded.capturedBytes,
    truncated: bounded.truncated,
    ...(issue === undefined ? {} : { issue }),
  };
}

export function decodeTextBody(input: DecodeTextBodyInput | string): DecodedBody {
  const isStringInput = typeof input === 'string';
  const textValue = isStringInput ? input : readDataProperty(input, 'text');
  const mimeTypeValue = isStringInput ? '' : readDataProperty(input, 'mimeType');
  const maxBytesValue = isStringInput ? undefined : readDataProperty(input, 'maxBytes');
  const maxDepthValue = isStringInput ? undefined : readDataProperty(input, 'maxDepth');
  const text = typeof textValue === 'string' ? textValue : '';
  const mimeType = typeof mimeTypeValue === 'string' ? mimeTypeValue : 'text/plain';
  const maxBytes = finiteLimit(maxBytesValue, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxDepth = finiteLimit(maxDepthValue, DEFAULT_MAX_DEPTH, DEFAULT_MAX_DEPTH);
  const bounded = boundUtf8(text, maxBytes);

  if (bounded.truncated) return textResult(bounded);

  const normalizedMime = normalizedMimeType(mimeType);
  if (normalizedMime === 'application/json' || normalizedMime.endsWith('+json')) {
    try {
      const value: unknown = JSON.parse(bounded.text);
      const issue = inspectStructure(value, maxDepth);
      if (issue !== undefined) return textResult(bounded, issue);
      return {
        kind: 'json',
        text: bounded.text,
        value,
        originalBytes: bounded.originalBytes,
        originalBytesExact: bounded.originalBytesExact,
        capturedBytes: bounded.capturedBytes,
        truncated: false,
      };
    } catch {
      return textResult(bounded, 'malformed');
    }
  }

  if (normalizedMime === 'application/x-www-form-urlencoded') {
    const fields = Array.from(new URLSearchParams(bounded.text), ([name, value]) => ({
      name,
      value,
    }));
    return {
      kind: 'form',
      text: bounded.text,
      fields: fields.slice(0, DEFAULT_MAX_KEYS),
      originalBytes: bounded.originalBytes,
      originalBytesExact: bounded.originalBytesExact,
      capturedBytes: bounded.capturedBytes,
      truncated: false,
    };
  }

  if (normalizedMime === 'multipart/form-data') {
    const multipart = parseMultipartBody(bounded.text, mimeType);
    if (multipart === undefined) return textResult(bounded, 'malformed');
    const fields = multipart.parts
      .filter((part) => part.filename === undefined)
      .map(({ name, value }) => ({ name, value }));
    return {
      kind: 'multipart',
      text: bounded.text,
      fields,
      originalBytes: bounded.originalBytes,
      originalBytesExact: bounded.originalBytesExact,
      capturedBytes: bounded.capturedBytes,
      truncated: false,
    };
  }

  return textResult(bounded);
}
