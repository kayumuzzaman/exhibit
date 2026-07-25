export type OriginPermission =
  | Readonly<{
      ok: true;
      origin: string;
      pattern: string;
    }>
  | Readonly<{
      ok: false;
      reason: 'restricted-page';
    }>;

const MAX_PAGE_URL_CODE_UNITS = 8_192;

function safeHttpUrl(input: string): URL | null {
  if (input.length > MAX_PAGE_URL_CODE_UNITS) {
    return null;
  }
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function deriveOriginPermission(input: string): OriginPermission {
  const url = safeHttpUrl(input);
  if (url === null || url.origin === 'null') {
    return { ok: false, reason: 'restricted-page' };
  }
  return {
    ok: true,
    origin: url.origin,
    pattern: `${url.origin}/*`,
  };
}

export function sanitizePageUrl(input: string): string | undefined {
  const url = safeHttpUrl(input);
  if (url === null || url.origin === 'null') {
    return undefined;
  }
  return `${url.origin}${url.pathname}`;
}
