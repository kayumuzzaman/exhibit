import type { SanitizedCapturedRequest } from '../../domain/sanitized';

type SearchEntry = Readonly<{
  request: SanitizedCapturedRequest;
  text: string;
}>;

function normalized(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function urlParts(value: string): readonly string[] {
  try {
    const url = new URL(value);
    return [
      url.origin,
      decoded(url.pathname),
      ...[...url.searchParams].flatMap(([name, parameterValue]) => [
        name,
        parameterValue,
      ]),
    ];
  } catch {
    return [value];
  }
}

function bodyText(request: SanitizedCapturedRequest): readonly string[] {
  return [request.request.body?.text ?? '', request.response.body.text ?? ''];
}

function evidenceText(request: SanitizedCapturedRequest): readonly string[] {
  return [
    ...Object.values(request.evidence).map(String),
    ...(request.classification?.evidence ?? []),
    ...(request.explanation?.evidence ?? []),
    ...(request.explanation?.guidance ?? []),
    request.explanation?.summary ?? '',
    request.explanation?.outcome ?? '',
  ];
}

function searchableText(
  request: SanitizedCapturedRequest,
  interactionLabel: string | undefined,
): string {
  return normalized(
    [
      request.method,
      ...urlParts(request.url),
      ...bodyText(request),
      String(request.response.status),
      request.response.statusText ?? '',
      request.classification?.kind ?? '',
      request.classification?.confidence ?? '',
      interactionLabel ?? '',
      ...evidenceText(request),
    ].join('\n'),
  );
}

function compareRequests(
  left: SanitizedCapturedRequest,
  right: SanitizedCapturedRequest,
): number {
  const leftTime = Number.isFinite(left.startedAt)
    ? left.startedAt
    : Number.POSITIVE_INFINITY;
  const rightTime = Number.isFinite(right.startedAt)
    ? right.startedAt
    : Number.POSITIVE_INFINITY;
  return leftTime - rightTime || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * Incremental index over sanitized records only. Call remove when the session
 * ring evicts a request.
 */
export class SearchIndex {
  readonly #entries = new Map<string, SearchEntry>();

  get size(): number {
    return this.#entries.size;
  }

  add(request: SanitizedCapturedRequest, interactionLabel?: string): void {
    this.#entries.set(request.id, {
      request,
      text: searchableText(request, interactionLabel),
    });
  }

  remove(requestId: string): boolean {
    return this.#entries.delete(requestId);
  }

  query(value: string): SanitizedCapturedRequest[] {
    const terms = normalized(value)
      .split(/\s+/u)
      .filter((term) => term.length > 0);
    return [...this.#entries.values()]
      .filter(({ text }) => terms.every((term) => text.includes(term)))
      .map(({ request }) => request)
      .sort(compareRequests);
  }
}
