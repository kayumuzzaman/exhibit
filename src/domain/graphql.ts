import type { CapturedRequest } from './model';

export type GraphQLDetection = Readonly<{
  evidence: readonly string[];
}>;

function mimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function detection(evidence: string): GraphQLDetection {
  return Object.freeze({ evidence: Object.freeze([evidence]) });
}

function looksLikeDocument(value: string): boolean {
  return /^(?:query|mutation|subscription|fragment)\b|^\{/i.test(value.trim());
}

function hasJsonQuery(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'query');
    return (
      descriptor !== undefined &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      looksLikeDocument(descriptor.value)
    );
  } catch {
    return false;
  }
}

function urlHasQuery(url: string): boolean {
  try {
    const query = new URL(url).searchParams.get('query');
    return query !== null && looksLikeDocument(query);
  } catch {
    return false;
  }
}

export function detectGraphQL(request: CapturedRequest): GraphQLDetection | undefined {
  const requestMime = mimeType(request.request.body?.mimeType);
  if (requestMime === 'application/graphql') {
    return detection('Request MIME type is application/graphql.');
  }

  const responseMime = mimeType(request.response.body.mimeType);
  if (responseMime === 'application/graphql-response+json') {
    return detection('Response MIME type is application/graphql-response+json.');
  }

  if (urlHasQuery(request.url)) {
    return detection('URL query contains a nonempty GraphQL query parameter.');
  }

  const body = request.request.body;
  if (
    requestMime === 'application/json' &&
    body?.state === 'available' &&
    body.text !== undefined &&
    hasJsonQuery(body.text)
  ) {
    return detection('JSON request body contains a GraphQL query field.');
  }

  return undefined;
}
