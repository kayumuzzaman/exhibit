import type { InteractionGroup } from '../../domain/model';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';

export type RequestOutcome = 'success' | 'redirect' | 'failure';
export type CacheFilter = 'hit' | 'miss';

export type RequestFilter = Readonly<{
  /**
   * API-first is explicit and enabled by default. Set false to include document,
   * static, SSR, and unknown traffic.
   */
  apiOnly?: boolean;
  interactionId?: string;
  interactionGroups?: readonly InteractionGroup[];
  outcome?: RequestOutcome;
  slowOnly?: boolean;
  slowThresholdMs?: number;
  methods?: readonly string[];
  domains?: readonly string[];
  cache?: CacheFilter;
  kinds?: readonly string[];
}>;

const API_KINDS = new Set([
  'api',
  'fetch-xhr',
  'form',
  'graphql',
  'next-api',
  'next-server-action',
  'rsc',
]);
const DEFAULT_SLOW_THRESHOLD_MS = 1_000;

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function requestDomain(request: SanitizedCapturedRequest): string | undefined {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function matchesOutcome(
  request: SanitizedCapturedRequest,
  selected: RequestOutcome | undefined,
): boolean {
  if (selected === undefined) return true;
  const status = request.response.status;
  if (selected === 'failure') return status === 0 || status >= 400;
  if (selected === 'redirect') return status >= 300 && status < 400;
  return status >= 200 && status < 300;
}

function interactionRequestIds(filter: RequestFilter): ReadonlySet<string> | null {
  if (filter.interactionId === undefined) return null;
  const group = filter.interactionGroups?.find(
    (candidate) =>
      candidate.id === filter.interactionId ||
      candidate.event?.id === filter.interactionId,
  );
  return new Set(group?.requestIds ?? []);
}

export function filterRequests(
  requests: readonly SanitizedCapturedRequest[],
  filter: RequestFilter,
): SanitizedCapturedRequest[] {
  const methods = normalizedSet(filter.methods);
  const domains = normalizedSet(filter.domains);
  const kinds = normalizedSet(filter.kinds);
  const interactionIds = interactionRequestIds(filter);
  const apiOnly = filter.apiOnly ?? true;
  const threshold = Number.isFinite(filter.slowThresholdMs)
    ? Math.max(0, filter.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS)
    : DEFAULT_SLOW_THRESHOLD_MS;

  return requests.filter((request) => {
    const method = request.method.toLowerCase();
    const kind = request.classification?.kind.trim().toLowerCase() ?? 'unknown';
    const domain = domains.size === 0 ? undefined : requestDomain(request);

    return (
      (interactionIds === null || interactionIds.has(request.id)) &&
      (!apiOnly || API_KINDS.has(kind)) &&
      matchesOutcome(request, filter.outcome) &&
      (!filter.slowOnly || request.timing.totalMs >= threshold) &&
      (methods.size === 0 || methods.has(method)) &&
      (domains.size === 0 || (domain !== undefined && domains.has(domain))) &&
      (filter.cache === undefined ||
        (filter.cache === 'hit'
          ? request.evidence.fromCache === true
          : request.evidence.fromCache !== true)) &&
      (kinds.size === 0 || kinds.has(kind))
    );
  });
}
