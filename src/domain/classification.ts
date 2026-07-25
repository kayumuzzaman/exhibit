import { detectGraphQL } from './graphql';
import type { CapturedRequest, Classification, Header } from './model';
import {
  apiPathEvidence,
  detectRsc,
  detectServerAction,
  nextFrameworkEvidence,
} from './nextjs';

const ROUTE_IMPLEMENTATION_LIMIT =
  'A browser observer cannot prove which server-side route implementation handled the request.';
const SSR_LIMIT =
  'Browser-visible evidence cannot distinguish server rendering from prerendered HTML with certainty.';

function mimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function headerValue(
  headers: readonly Header[],
  searchedName: string,
): string | undefined {
  const lowerName = searchedName.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lowerName)?.value;
}

function makeClassification(
  kind: string,
  confidence: Classification['confidence'],
  evidence: readonly string[],
): Classification {
  return Object.freeze({
    kind,
    confidence,
    evidence: Object.freeze([...evidence]),
  });
}

function jsonMime(value: string): boolean {
  return value === 'application/json' || value.endsWith('+json');
}

function staticPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return (
      pathname.includes('/_next/static/') ||
      /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/.test(pathname)
    );
  } catch {
    return false;
  }
}

function staticMime(value: string): boolean {
  return (
    value === 'text/css' ||
    value === 'application/javascript' ||
    value === 'text/javascript' ||
    value.startsWith('image/') ||
    value.startsWith('font/')
  );
}

export function classifyRequest(request: CapturedRequest): Classification {
  const serverAction = detectServerAction(request);
  if (serverAction !== undefined) return serverAction;

  const rsc = detectRsc(request);
  if (rsc !== undefined) return rsc;

  const graphQL = detectGraphQL(request);
  if (graphQL !== undefined) {
    return makeClassification('graphql', 'confirmed', graphQL.evidence);
  }

  const requestMime = mimeType(request.request.body?.mimeType);
  if (
    requestMime === 'application/x-www-form-urlencoded' ||
    requestMime === 'multipart/form-data'
  ) {
    return makeClassification('form', 'confirmed', [
      `Request MIME type is ${requestMime}.`,
    ]);
  }

  const responseMime = mimeType(request.response.body.mimeType);
  const fetchDestination = headerValue(request.request.headers, 'sec-fetch-dest')
    ?.trim()
    .toLowerCase();
  const frameworkEvidence = nextFrameworkEvidence(request);

  if (
    fetchDestination === 'document' &&
    responseMime === 'text/html' &&
    frameworkEvidence.length > 0
  ) {
    return makeClassification('ssr', 'likely', [
      'Request header Sec-Fetch-Dest is document.',
      'Response MIME type is text/html.',
      ...frameworkEvidence,
      SSR_LIMIT,
    ]);
  }

  const apiPath = apiPathEvidence(request.url);
  if (apiPath !== undefined && frameworkEvidence.length > 0) {
    return makeClassification('next-api', 'likely', [
      apiPath,
      ...frameworkEvidence,
      ROUTE_IMPLEMENTATION_LIMIT,
    ]);
  }

  if (fetchDestination === 'document') {
    return makeClassification('document', 'confirmed', [
      'Request header Sec-Fetch-Dest is document.',
      ...(responseMime === 'text/html' ? ['Response MIME type is text/html.'] : []),
    ]);
  }

  if (responseMime === 'text/html') {
    return makeClassification('document', 'likely', [
      'Response MIME type is text/html.',
    ]);
  }

  const looksStatic = staticPath(request.url);
  const hasStaticMime = staticMime(responseMime);
  if (looksStatic || hasStaticMime) {
    return makeClassification('static', 'likely', [
      ...(looksStatic ? ['URL path looks like a static asset.'] : []),
      ...(hasStaticMime ? [`Response MIME type is ${responseMime}.`] : []),
    ]);
  }

  const apiEvidence: string[] = [];
  if (jsonMime(responseMime)) {
    apiEvidence.push(`Response MIME type is ${responseMime}.`);
  } else if (jsonMime(requestMime)) {
    apiEvidence.push(`Request MIME type is ${requestMime}.`);
  } else if (apiPath !== undefined) {
    apiEvidence.push(apiPath);
  }
  if (apiEvidence.length > 0) {
    return makeClassification('api', 'likely', apiEvidence);
  }

  const fetchEvidence: string[] = [];
  if (
    headerValue(request.request.headers, 'x-requested-with')?.trim().toLowerCase() ===
    'xmlhttprequest'
  ) {
    fetchEvidence.push('Request header X-Requested-With reports XMLHttpRequest.');
  }
  if (request.evidence.initiator?.toLowerCase() === 'script') {
    fetchEvidence.push('HAR initiator type is script.');
  }
  if (fetchEvidence.length > 0) {
    return makeClassification('fetch-xhr', 'likely', fetchEvidence);
  }

  return makeClassification('unknown', 'unknown', []);
}
