import type { SanitizedCapturedRequest } from '../../domain/sanitized';

const MAX_RELATED_CALLS = 5;

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function route(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function RelatedRequests({
  relatedRequests,
  request,
}: Readonly<{
  relatedRequests: readonly SanitizedCapturedRequest[];
  request: SanitizedCapturedRequest;
}>) {
  const repeated = relatedRequests.filter(
    (candidate) =>
      candidate.id !== request.id &&
      candidate.method.toUpperCase() === request.method.toUpperCase() &&
      normalizedUrl(candidate.url) === normalizedUrl(request.url),
  );
  const otherCalls = relatedRequests.filter((candidate) => candidate.id !== request.id);
  const visibleCalls = otherCalls.slice(0, MAX_RELATED_CALLS);
  const hiddenCallCount = otherCalls.length - visibleCalls.length;
  const facts = [
    ...(request.evidence.redirectUrl === undefined
      ? []
      : [`Response redirects to ${request.evidence.redirectUrl}.`]),
    ...(request.evidence.fromCache === true
      ? ['Response was served from browser cache.']
      : []),
    ...(request.evidence.fromServiceWorker === true
      ? ['A service worker supplied the response.']
      : []),
    ...(repeated.length === 0
      ? []
      : [
          `${repeated.length} other request${repeated.length === 1 ? '' : 's'} matched this method and normalized URL: repeated call, not proof of a retry.`,
        ]),
  ];

  return (
    <section
      aria-labelledby="related-heading"
      className="explain-section related-requests"
    >
      <p className="eyebrow">Related traffic</p>
      <h3 id="related-heading">Request context</h3>
      {visibleCalls.length === 0 ? null : (
        <ul
          aria-label="Other calls correlated to this interaction"
          className="related-call-list"
        >
          {visibleCalls.map((candidate) => (
            <li key={candidate.id}>
              <code>
                {candidate.method.toUpperCase()} {route(candidate.url)}
              </code>
              <span>
                {candidate.response.status === 0
                  ? 'No response'
                  : `HTTP ${candidate.response.status}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hiddenCallCount > 0 ? (
        <p className="related-call-limit">
          {hiddenCallCount} additional correlated call
          {hiddenCallCount === 1 ? '' : 's'} not shown.
        </p>
      ) : null}
      {facts.length === 0 ? null : (
        <ul className="evidence-facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {facts.length === 0 && visibleCalls.length === 0 ? (
        <p>
          No related call, redirect, repeat, cache, or service-worker fact was captured.
        </p>
      ) : null}
    </section>
  );
}
