import type { CapturedRequest } from './model';

export type GraphQLDetection = Readonly<{
  evidence: readonly string[];
}>;

const MAX_DOCUMENT_CHARACTERS = 64 * 1_024;
const MAX_SELECTION_DEPTH = 64;

function mimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function detection(evidence: string): GraphQLDetection {
  return Object.freeze({ evidence: Object.freeze([evidence]) });
}

function looksLikeDocument(value: string): boolean {
  const document = value.trim();
  if (document.length === 0 || document.length > MAX_DOCUMENT_CHARACTERS) {
    return false;
  }

  const firstSelection = document.indexOf('{');
  if (firstSelection < 0) return false;
  const prefix = document.slice(0, firstSelection).trim();
  if (
    prefix.length > 0 &&
    !/^(?:query|mutation|subscription)\b/i.test(prefix) &&
    !/^fragment\s+[_A-Za-z][_0-9A-Za-z]*\s+on\s+[_A-Za-z][_0-9A-Za-z]*(?:\s+@[^{]+)*$/i.test(
      prefix,
    )
  ) {
    return false;
  }

  let depth = 0;
  let sawSelection = false;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < document.length; index += 1) {
    const character = document.charAt(index);
    if (inComment) {
      if (character === '\n' || character === '\r') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '#') {
      inComment = true;
    } else if (character === '"') {
      inString = true;
    } else if (character === '{') {
      sawSelection = true;
      depth += 1;
      if (depth > MAX_SELECTION_DEPTH) return false;
    } else if (character === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return sawSelection && depth === 0 && !inString;
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
