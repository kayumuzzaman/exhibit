import type {
  SanitizedCapturedRequest,
  SanitizedInteractionEvent,
} from '../../domain/sanitized';

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
  interaction: SanitizedInteractionEvent | undefined,
): string {
  const interactionLabel =
    interaction?.target?.name ??
    interaction?.target?.text ??
    interaction?.target?.role ??
    interaction?.target?.tag ??
    interaction?.kind ??
    '';
  return normalized(
    [
      request.method,
      ...urlParts(request.url),
      ...bodyText(request),
      String(request.response.status),
      request.response.statusText ?? '',
      request.classification?.kind ?? '',
      request.classification?.confidence ?? '',
      interactionLabel,
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
  readonly #sources = new Map<
    string,
    Readonly<{
      interaction: SanitizedInteractionEvent | undefined;
      request: SanitizedCapturedRequest;
    }>
  >();

  get size(): number {
    return this.#entries.size;
  }

  add(
    request: SanitizedCapturedRequest,
    interaction?: SanitizedInteractionEvent,
  ): void {
    this.#sources.set(request.id, { interaction, request });
    this.#entries.set(request.id, {
      request,
      text: searchableText(request, interaction),
    });
  }

  remove(requestId: string): boolean {
    this.#sources.delete(requestId);
    return this.#entries.delete(requestId);
  }

  synchronize(
    requests: readonly SanitizedCapturedRequest[],
    interactions: ReadonlyMap<string, SanitizedInteractionEvent> = new Map(),
  ): void {
    const nextIds = new Set(requests.map(({ id }) => id));
    for (const requestId of this.#entries.keys()) {
      if (!nextIds.has(requestId)) this.remove(requestId);
    }
    for (const request of requests) {
      const interaction = interactions.get(request.id);
      const previous = this.#sources.get(request.id);
      if (previous?.request !== request || previous.interaction !== interaction) {
        this.add(request, interaction);
      }
    }
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
