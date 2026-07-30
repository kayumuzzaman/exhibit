import type { CapturedRequest, Classification, Header } from './model';

const INTERNAL_WARNING =
  'Next.js RSC headers and query markers are internal and version-sensitive.';
const ACTION_INTERNAL_WARNING =
  'Next.js action and Flight headers are internal and version-sensitive.';
const ACTION_REQUEST_ONLY_LIMIT =
  'The response is not a Flight payload, so only the request side names an action.';
const PRERENDER_STRIPPED_LIMIT =
  'A proxy or CDN can strip these headers, so rendering during this request is not proven.';

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

const ROUTER_VARY_HEADERS = ['next-router-state-tree', 'next-router-prefetch'];

/**
 * Next.js route handlers no longer advertise themselves with `X-Powered-By`,
 * but they still vary on the router's own request headers. Those header names
 * are framework-specific, so their presence in `Vary` is protocol evidence.
 */
function variesOnRouterHeaders(headers: readonly Header[]): boolean {
  const vary = headerValue(headers, 'vary')?.toLowerCase();
  if (vary === undefined) return false;
  const listed = new Set(vary.split(',').map((value) => value.trim()));
  return ROUTER_VARY_HEADERS.every((name) => listed.has(name));
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
  if (presentHeader(request.response.headers, 'x-nextjs-prerender')) {
    evidence.push('Response header X-Nextjs-Prerender is present.');
  }
  if (variesOnRouterHeaders(request.response.headers)) {
    evidence.push('Response header Vary lists Next.js router request headers.');
  }
  return frozenEvidence(evidence);
}

export type NextRenderMode = 'prerendered' | 'per-request';

export type NextRenderEvidence = Readonly<{
  mode: NextRenderMode;
  evidence: readonly string[];
}>;

function staleSeconds(headers: readonly Header[]): number | undefined {
  const raw = headerValue(headers, 'x-nextjs-stale-time')?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

/**
 * Next.js marks prerendered HTML with `X-Nextjs-Prerender`, so a browser
 * observer can tell a cached prerender from HTML rendered during this request.
 * Presence proves the prerender; absence only suggests per-request rendering,
 * because an intermediary can remove the header.
 */
export function nextRenderEvidence(request: CapturedRequest): NextRenderEvidence {
  const headers = request.response.headers;
  if (!presentHeader(headers, 'x-nextjs-prerender')) {
    return Object.freeze({
      mode: 'per-request' as const,
      evidence: frozenEvidence([
        'No prerender header is present, which is consistent with rendering during this request.',
        PRERENDER_STRIPPED_LIMIT,
      ]),
    });
  }

  const evidence = [
    'The HTML was prerendered before this request rather than rendered for it.',
  ];
  const cache = headerValue(headers, 'x-nextjs-cache')?.trim();
  if (cache !== undefined && cache.length > 0) {
    evidence.push(`Response header X-Nextjs-Cache reports ${cache}.`);
  }
  const stale = staleSeconds(headers);
  if (stale !== undefined) {
    evidence.push(`Response header X-Nextjs-Stale-Time reports ${stale} seconds.`);
  }
  return Object.freeze({
    mode: 'prerendered' as const,
    evidence: frozenEvidence(evidence),
  });
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
  // `Next-Action` is a request header, so any script on the page can send it.
  // Only a Flight response corroborates it from the server side, which is the
  // same bar `detectRsc` applies before it will say confirmed.
  const hasFlightMime = mimeType(request.response.body.mimeType) === 'text/x-component';
  if (hasFlightMime) {
    evidence.push('Response MIME type is text/x-component.');
  } else {
    evidence.push(ACTION_REQUEST_ONLY_LIMIT);
  }
  evidence.push(ACTION_INTERNAL_WARNING);
  return classification(
    'next-server-action',
    hasFlightMime ? 'confirmed' : 'likely',
    evidence,
    actionId,
  );
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
