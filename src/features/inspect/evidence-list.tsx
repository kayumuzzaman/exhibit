import type { SanitizedCapturedRequest } from '../../domain/sanitized';

const MAX_REDIRECT_HOPS = 8;

function redirectFacts(
  request: SanitizedCapturedRequest,
  relatedRequests: readonly SanitizedCapturedRequest[],
): readonly string[] {
  const requestsById = new Map<string, SanitizedCapturedRequest>();
  for (const candidate of relatedRequests) {
    if (!requestsById.has(candidate.id)) requestsById.set(candidate.id, candidate);
  }
  requestsById.set(request.id, request);

  const before: SanitizedCapturedRequest[] = [];
  const seen = new Set([request.id]);
  let cursor = request;
  while (cursor.evidence.redirectParentId !== undefined) {
    const parent = requestsById.get(cursor.evidence.redirectParentId);
    if (parent === undefined || seen.has(parent.id)) break;
    before.push(parent);
    seen.add(parent.id);
    cursor = parent;
  }
  before.reverse();

  const after: SanitizedCapturedRequest[] = [];
  cursor = request;
  while (true) {
    const child = relatedRequests.find(
      (candidate) =>
        candidate.evidence.redirectParentId === cursor.id && !seen.has(candidate.id),
    );
    if (child === undefined) break;
    after.push(child);
    seen.add(child.id);
    cursor = child;
  }

  const chain = [...before, request, ...after];
  const hopCount = Math.max(0, chain.length - 1);
  const visibleHopCount = Math.min(hopCount, MAX_REDIRECT_HOPS);
  const facts = Array.from({ length: visibleHopCount }, (_, index) => {
    const source = chain[index]!;
    const target = chain[index + 1]!;
    return `Redirect hop ${index + 1}: ${source.url} → ${source.evidence.redirectUrl ?? target.url}`;
  });
  if (hopCount > visibleHopCount) {
    facts.push(`Redirect chain display limited to ${MAX_REDIRECT_HOPS} hops.`);
  }
  if (facts.length === 0 && request.evidence.redirectUrl !== undefined) {
    facts.push(`HAR redirect target: ${request.evidence.redirectUrl}`);
  }
  return facts;
}

export function EvidenceList({
  relatedRequests = [],
  request,
}: Readonly<{
  relatedRequests?: readonly SanitizedCapturedRequest[];
  request: SanitizedCapturedRequest;
}>) {
  const classification = request.classification;
  const body = request.response.body;
  const facts = [
    ...(classification?.evidence ?? []),
    ...(request.evidence.fromCache === true
      ? ['HAR reports a browser cache hit.']
      : []),
    ...(request.evidence.fromServiceWorker === true
      ? ['HAR reports response delivery through a service worker.']
      : []),
    ...redirectFacts(request, relatedRequests),
    ...(body.reason === undefined ? [] : [`Body support state: ${body.reason}`]),
    ...(body.state === 'truncated'
      ? [`Body truncated at ${body.capturedSize} of ${body.size} bytes.`]
      : []),
  ];

  return (
    <section aria-labelledby="evidence-list-heading" className="inspect-section">
      <div className="inspect-section__heading">
        <p className="eyebrow">Source facts</p>
        <h3 id="evidence-list-heading">Evidence ledger</h3>
      </div>
      {facts.length === 0 ? (
        <p>No additional protocol evidence was captured.</p>
      ) : (
        <ol className="evidence-list">
          {facts.map((fact, index) => (
            <li key={`${index}-${fact}`}>{fact}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
