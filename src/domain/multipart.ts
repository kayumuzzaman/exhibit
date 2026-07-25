const MAX_MULTIPART_CHARACTERS = 1024 * 1024;
const MAX_MIME_TYPE_CHARACTERS = 4096;
const MAX_BOUNDARY_CHARACTERS = 200;
const MAX_PARTS = 10_000;
const MAX_HEADERS_PER_PART = 100;
const MAX_FIELD_NAME_CHARACTERS = 256;
const MAX_FILENAME_CHARACTERS = 1024;

export type ParsedMultipartPart = Readonly<{
  name: string;
  filename?: string;
  value: string;
}>;

export type ParsedMultipartBody = Readonly<{
  boundary: string;
  lineEnding: '\r\n' | '\n';
  parts: readonly ParsedMultipartPart[];
}>;

type TextLine = Readonly<{
  start: number;
  content: string;
  next: number;
  lineEnding: '' | '\r\n' | '\n';
}>;

function unquoteParameter(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  if (!trimmed.endsWith('"') || trimmed.length < 2) return undefined;
  const unquoted = trimmed.slice(1, -1);
  return unquoted.includes('"') ? undefined : unquoted;
}

function multipartBoundary(mimeType: string): string | undefined {
  if (mimeType.length > MAX_MIME_TYPE_CHARACTERS) return undefined;

  for (const parameter of mimeType.split(';').slice(1)) {
    const separator = parameter.indexOf('=');
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'boundary') {
      continue;
    }

    const boundary = unquoteParameter(parameter.slice(separator + 1));
    if (
      boundary !== undefined &&
      boundary.length > 0 &&
      boundary.length <= MAX_BOUNDARY_CHARACTERS &&
      /^[0-9A-Za-z'()+_,./:=?-]+$/u.test(boundary)
    ) {
      return boundary;
    }
    return undefined;
  }

  return undefined;
}

function readLine(text: string, start: number): TextLine {
  const newline = text.indexOf('\n', start);
  if (newline < 0) {
    return {
      start,
      content: text.slice(start),
      next: text.length,
      lineEnding: '',
    };
  }

  const hasCarriageReturn = newline > start && text[newline - 1] === '\r';
  return {
    start,
    content: text.slice(start, hasCarriageReturn ? newline - 1 : newline),
    next: newline + 1,
    lineEnding: hasCarriageReturn ? '\r\n' : '\n',
  };
}

function stripTerminalLineBreak(value: string): string | undefined {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return undefined;
}

function parseDisposition(
  disposition: string,
): Readonly<{ name: string; filename?: string }> | undefined {
  const segments = disposition.split(';');
  if (segments.shift()?.trim().toLowerCase() !== 'form-data') {
    return undefined;
  }

  let name: string | undefined;
  let filename: string | undefined;
  let filenameSeen = false;
  for (const parameter of segments) {
    const separator = parameter.indexOf('=');
    if (separator < 0) return undefined;
    const parameterName = parameter.slice(0, separator).trim().toLowerCase();
    const parameterValue = unquoteParameter(parameter.slice(separator + 1));
    if (parameterValue === undefined) return undefined;

    if (parameterName === 'name') {
      if (name !== undefined) return undefined;
      name = parameterValue;
    } else if (parameterName === 'filename') {
      if (filenameSeen) return undefined;
      filenameSeen = true;
      filename = parameterValue;
    }
  }

  if (name === undefined) return undefined;
  return filenameSeen && filename !== undefined ? { name, filename } : { name };
}

function parsePart(valueWithLineBreak: string): ParsedMultipartPart | undefined {
  const value = stripTerminalLineBreak(valueWithLineBreak);
  if (value === undefined) return undefined;

  const crlfSeparator = value.indexOf('\r\n\r\n');
  const lfSeparator = value.indexOf('\n\n');
  const headerEnd =
    crlfSeparator < 0
      ? lfSeparator
      : lfSeparator < 0
        ? crlfSeparator
        : Math.min(crlfSeparator, lfSeparator);
  if (headerEnd < 0) return undefined;

  const separatorLength = headerEnd === crlfSeparator ? 4 : 2;
  const headerText = value.slice(0, headerEnd);
  if (headerText.includes('\r') && crlfSeparator < 0) return undefined;
  const headerLines = headerText.split(/\r?\n/u);
  if (headerLines.length === 0 || headerLines.length > MAX_HEADERS_PER_PART) {
    return undefined;
  }

  let disposition: string | undefined;
  for (const headerLine of headerLines) {
    const separator = headerLine.indexOf(':');
    if (separator <= 0) return undefined;
    const headerName = headerLine.slice(0, separator).trim().toLowerCase();
    const headerValue = headerLine.slice(separator + 1).trim();
    if (headerName === 'content-disposition') {
      if (disposition !== undefined) return undefined;
      disposition = headerValue;
    }
  }
  if (disposition === undefined) return undefined;

  const parsedDisposition = parseDisposition(disposition);
  if (parsedDisposition === undefined) return undefined;
  const { name, filename } = parsedDisposition;
  if (
    name.length === 0 ||
    name.length > MAX_FIELD_NAME_CHARACTERS ||
    name.includes('\r') ||
    name.includes('\n')
  ) {
    return undefined;
  }

  if (
    filename !== undefined &&
    (filename.length > MAX_FILENAME_CHARACTERS ||
      filename.includes('\r') ||
      filename.includes('\n'))
  ) {
    return undefined;
  }

  return {
    name,
    ...(filename === undefined ? {} : { filename }),
    value: value.slice(headerEnd + separatorLength),
  };
}

export function parseMultipartBody(
  text: string,
  mimeType: string,
): ParsedMultipartBody | undefined {
  if (text.length > MAX_MULTIPART_CHARACTERS) return undefined;
  const boundary = multipartBoundary(mimeType);
  if (boundary === undefined) return undefined;

  const delimiter = `--${boundary}`;
  const closingDelimiter = `${delimiter}--`;
  let cursor = 0;
  let openingLine: (TextLine & Readonly<{ lineEnding: '\r\n' | '\n' }>) | undefined;

  while (cursor < text.length) {
    const line = readLine(text, cursor);
    if (line.content === delimiter) {
      if (line.lineEnding === '') return undefined;
      openingLine = { ...line, lineEnding: line.lineEnding };
      break;
    }
    if (line.content.includes(delimiter)) return undefined;
    if (line.next === text.length) break;
    cursor = line.next;
  }
  if (openingLine === undefined) return undefined;

  const parts: ParsedMultipartPart[] = [];
  let partStart = openingLine.next;
  cursor = partStart;

  while (cursor <= text.length) {
    const line = readLine(text, cursor);
    if (line.content.includes(delimiter)) {
      if (line.content !== delimiter && line.content !== closingDelimiter) {
        return undefined;
      }

      const part = parsePart(text.slice(partStart, line.start));
      if (part === undefined || parts.length >= MAX_PARTS) return undefined;
      parts.push(part);

      if (line.content === closingDelimiter) {
        if (line.next !== text.length) return undefined;
        return {
          boundary,
          lineEnding: openingLine.lineEnding,
          parts,
        };
      }

      if (line.lineEnding === '') return undefined;
      partStart = line.next;
      cursor = line.next;
      continue;
    }

    if (line.next === text.length) return undefined;
    cursor = line.next;
  }

  return undefined;
}
