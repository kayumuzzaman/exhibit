import type { CapturedRequest, Classification, Header } from './model';

const INTERNAL_WARNING =
  'Next.js RSC headers and query markers are internal and version-sensitive.';
const ACTION_INTERNAL_WARNING =
  'Next.js action and Flight headers are internal and version-sensitive.';

function headerValue(
  headers: readonly Header[],
  searchedName: string,
): string | undefined {
  const lowerName = searchedName.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lowerName)?.value;
}

function presentHeader(headers: readonly Header[], searchedName: string): boolean {
  return (headerValue(headers, searchedName)?.trim().length ?? 0) > 0;
}

function mimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function frozenEvidence(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function classification(
  kind: string,
  confidence: Classification['confidence'],
  evidence: readonly string[],
  actionId?: string,
): Classification {
  return Object.freeze({
    kind,
    confidence,
    evidence: frozenEvidence(evidence),
    ...(actionId === undefined ? {} : { actionId }),
  });
}

function parsedUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function apiPathEvidence(url: string): string | undefined {
  const pathname = parsedUrl(url)?.pathname.toLowerCase();
  return pathname === '/api' || pathname?.includes('/api/') === true
    ? 'URL path contains /api/.'
    : undefined;
}

export function nextFrameworkEvidence(request: CapturedRequest): readonly string[] {
  const evidence: string[] = [];
  const poweredBy = headerValue(request.response.headers, 'x-powered-by');
  if (poweredBy?.trim().toLowerCase() === 'next.js') {
    evidence.push('Response header X-Powered-By reports Next.js.');
  }
  if (presentHeader(request.response.headers, 'x-nextjs-cache')) {
    evidence.push('Response header X-Nextjs-Cache is present.');
  }
  if (presentHeader(request.response.headers, 'x-nextjs-matched-path')) {
    evidence.push('Response header X-Nextjs-Matched-Path is present.');
  }
  return frozenEvidence(evidence);
}

export function detectServerAction(
  request: CapturedRequest,
): Classification | undefined {
  const rawActionId = headerValue(request.request.headers, 'next-action');
  const actionId = rawActionId?.trim();
  if (request.method.toUpperCase() !== 'POST' || !actionId) return undefined;

  const evidence = [
    'Request method is POST.',
    'Request header Next-Action is present.',
  ];
  if (mimeType(request.response.body.mimeType) === 'text/x-component') {
    evidence.push('Response MIME type is text/x-component.');
  }
  evidence.push(ACTION_INTERNAL_WARNING);
  return classification('next-server-action', 'confirmed', evidence, actionId);
}

export function detectRsc(request: CapturedRequest): Classification | undefined {
  const hasRscHeader = headerValue(request.request.headers, 'rsc')?.trim() === '1';
  const hasRouterState = presentHeader(
    request.request.headers,
    'next-router-state-tree',
  );
  const hasFlightMime = mimeType(request.response.body.mimeType) === 'text/x-component';
  const hasRscQuery =
    (parsedUrl(request.url)?.searchParams.get('_rsc')?.trim().length ?? 0) > 0;

  if (!hasRscHeader && !hasRouterState && !hasFlightMime && !hasRscQuery) {
    return undefined;
  }

  const evidence: string[] = [];
  if (hasRscHeader) evidence.push('Request header RSC is 1.');
  if (hasRouterState) {
    evidence.push('Request header Next-Router-State-Tree is present.');
  }
  if (hasFlightMime) evidence.push('Response MIME type is text/x-component.');
  if (hasRscQuery) evidence.push('URL query contains _rsc.');
  evidence.push(INTERNAL_WARNING);

  return classification(
    'rsc',
    hasFlightMime && (hasRscHeader || hasRouterState) ? 'confirmed' : 'likely',
    evidence,
  );
}
