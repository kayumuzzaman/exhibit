import type { BodyContent, Header } from './model';
import type { SanitizedCapturedRequest } from './sanitized';

const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
]);
const CREDENTIAL_NAME_PARTS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'credential',
  'csrf',
  'xsrf',
  'session',
] as const;

function normalizedHeaderName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isCredentialHeaderName(name: string): boolean {
  const normalized = normalizedHeaderName(name);
  return (
    CREDENTIAL_HEADER_NAMES.has(normalized) ||
    CREDENTIAL_NAME_PARTS.some((part) => normalized.includes(part))
  );
}

export function sortedSafeHeaders(headers: readonly Header[]): Header[] {
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => !isCredentialHeaderName(header.name))
    .sort(
      (left, right) =>
        compareText(left.header.name.toLowerCase(), right.header.name.toLowerCase()) ||
        compareText(left.header.name, right.header.name) ||
        compareText(left.header.value, right.header.value) ||
        left.index - right.index,
    )
    .map(({ header }) => header);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function capturedText(body: BodyContent | undefined): string | undefined {
  if (
    body?.text === undefined ||
    (body.state !== 'available' && body.state !== 'truncated')
  ) {
    return undefined;
  }
  return body.text;
}

export function toSafeCurl(request: SanitizedCapturedRequest): string {
  const parts = [
    'curl',
    '--request',
    shellQuote(request.method.toUpperCase()),
    '--url',
    shellQuote(request.url),
  ];
  for (const header of sortedSafeHeaders(request.request.headers)) {
    parts.push('--header', shellQuote(`${header.name}: ${header.value}`));
  }
  const body = capturedText(request.request.body);
  if (body !== undefined) {
    parts.push('--data-raw', shellQuote(body));
  }
  return parts.join(' ');
}
