const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_KEYS = 10_000;
const MAX_MULTIPART_BOUNDARY_LENGTH = 200;

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

function finiteLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
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

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index)!;
    const width = utf8Width(codePoint);
    originalBytes += width;

    if (accepting && capturedBytes + width <= maxBytes) {
      captured.push(String.fromCodePoint(codePoint));
      capturedBytes += width;
    } else {
      accepting = false;
    }

    if (codePoint > 0xffff) index += 1;
  }

  return {
    text: captured.join(''),
    originalBytes,
    capturedBytes,
    truncated: capturedBytes < originalBytes,
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

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function multipartBoundary(mimeType: string): string | undefined {
  const parameters = mimeType.split(';').slice(1);
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=');
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'boundary') {
      continue;
    }

    const boundary = unquote(parameter.slice(separator + 1));
    if (
      boundary.length > 0 &&
      boundary.length <= MAX_MULTIPART_BOUNDARY_LENGTH &&
      !boundary.includes('\r') &&
      !boundary.includes('\n')
    ) {
      return boundary;
    }
  }
  return undefined;
}

function dispositionParameter(
  disposition: string,
  parameterName: string,
): string | undefined {
  for (const parameter of disposition.split(';').slice(1)) {
    const separator = parameter.indexOf('=');
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() === parameterName) {
      return unquote(parameter.slice(separator + 1));
    }
  }
  return undefined;
}

function decodeMultipartFields(
  text: string,
  mimeType: string,
): readonly DecodedField[] | undefined {
  const boundary = multipartBoundary(mimeType);
  if (boundary === undefined) return undefined;

  const fields: DecodedField[] = [];
  const delimiter = `--${boundary}`;
  for (const rawPart of text.split(delimiter).slice(1)) {
    if (fields.length >= DEFAULT_MAX_KEYS) break;
    if (rawPart.startsWith('--')) break;

    const part = rawPart.startsWith('\r\n')
      ? rawPart.slice(2)
      : rawPart.startsWith('\n')
        ? rawPart.slice(1)
        : rawPart;
    const separator = part.indexOf('\r\n\r\n');
    const fallbackSeparator = separator < 0 ? part.indexOf('\n\n') : -1;
    const headerEnd = separator >= 0 ? separator : fallbackSeparator;
    if (headerEnd < 0) continue;

    const separatorLength = separator >= 0 ? 4 : 2;
    const headers = part.slice(0, headerEnd).split(/\r?\n/u);
    const disposition = headers.find((header) =>
      header.toLowerCase().startsWith('content-disposition:'),
    );
    if (disposition === undefined) continue;
    if (dispositionParameter(disposition, 'filename') !== undefined) continue;

    const name = dispositionParameter(disposition, 'name');
    if (name === undefined) continue;
    const rawValue = part.slice(headerEnd + separatorLength);
    const value = rawValue.endsWith('\r\n')
      ? rawValue.slice(0, -2)
      : rawValue.endsWith('\n')
        ? rawValue.slice(0, -1)
        : rawValue;
    fields.push({ name, value });
  }

  return fields;
}

function textResult(bounded: BoundedText, issue?: DecodedBodyIssue): DecodedBody {
  return {
    kind: 'text',
    text: bounded.text,
    originalBytes: bounded.originalBytes,
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
  const maxBytes = finiteLimit(maxBytesValue, DEFAULT_MAX_BYTES);
  const maxDepth = finiteLimit(maxDepthValue, DEFAULT_MAX_DEPTH);
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
      capturedBytes: bounded.capturedBytes,
      truncated: false,
    };
  }

  if (normalizedMime === 'multipart/form-data') {
    const fields = decodeMultipartFields(bounded.text, mimeType);
    if (fields === undefined) return textResult(bounded, 'malformed');
    return {
      kind: 'multipart',
      text: bounded.text,
      fields,
      originalBytes: bounded.originalBytes,
      capturedBytes: bounded.capturedBytes,
      truncated: false,
    };
  }

  return textResult(bounded);
}
