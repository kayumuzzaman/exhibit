import type { CapturedRequest } from './model';

export type GraphQLDetection = Readonly<{
  confidence: 'confirmed' | 'likely';
  evidence: readonly string[];
}>;

const MAX_DOCUMENT_CHARACTERS = 64 * 1_024;
const MAX_SELECTION_DEPTH = 64;
const OPERATION_PREFIX =
  /^(?:query|mutation|subscription)(?:\s+[_A-Za-z][_0-9A-Za-z]*)?(?:\s*\([^{}]*\))?(?:\s+@[_A-Za-z][_0-9A-Za-z]*(?:\([^{}]*\))?)*$/i;
const FRAGMENT_PREFIX =
  /^fragment\s+[_A-Za-z][_0-9A-Za-z]*\s+on\s+[_A-Za-z][_0-9A-Za-z]*(?:\s+@[_A-Za-z][_0-9A-Za-z]*(?:\([^{}]*\))?)*$/i;
const TRAILING_WHITESPACE_OR_COMMENTS = /^(?:\s|#[^\r\n]*(?:\r?\n|$))*$/;

function mimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function detection(
  confidence: GraphQLDetection['confidence'],
  evidence: string,
): GraphQLDetection {
  return Object.freeze({
    confidence,
    evidence: Object.freeze([evidence]),
  });
}

function looksLikeDocument(value: string): boolean {
  if (value.length === 0 || value.length > MAX_DOCUMENT_CHARACTERS) {
    return false;
  }

  const document = value.trim();
  if (document.length === 0) return false;

  const firstSelection = document.indexOf('{');
  if (firstSelection < 0) return false;
  const prefix = document.slice(0, firstSelection).trim();
  if (
    prefix.length > 0 &&
    !OPERATION_PREFIX.test(prefix) &&
    !FRAGMENT_PREFIX.test(prefix)
  ) {
    return false;
  }

  let depth = 0;
  let sawSelection = false;
  let sawSelectionName = false;
  let finalSelectionEnd = -1;
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
      if (depth === 0) finalSelectionEnd = index;
    } else if (depth > 0 && /[_A-Za-z]/.test(character)) {
      sawSelectionName = true;
    }
  }
  return (
    sawSelection &&
    sawSelectionName &&
    depth === 0 &&
    !inString &&
    finalSelectionEnd >= 0 &&
    TRAILING_WHITESPACE_OR_COMMENTS.test(document.slice(finalSelectionEnd + 1))
  );
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
    return detection('confirmed', 'Request MIME type is application/graphql.');
  }

  const responseMime = mimeType(request.response.body.mimeType);
  if (responseMime === 'application/graphql-response+json') {
    return detection(
      'confirmed',
      'Response MIME type is application/graphql-response+json.',
    );
  }

  if (urlHasQuery(request.url)) {
    return detection('likely', 'URL query contains a plausible GraphQL document.');
  }

  const body = request.request.body;
  if (
    requestMime === 'application/json' &&
    body?.state === 'available' &&
    body.text !== undefined &&
    hasJsonQuery(body.text)
  ) {
    return detection(
      'likely',
      'JSON request body contains a plausible GraphQL document.',
    );
  }

  return undefined;
}
