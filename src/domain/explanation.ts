import { classifyRequest } from './classification';
import type { CapturedRequest, Classification, Explanation, Header } from './model';

type Outcome =
  | 'success'
  | 'redirect'
  | 'client-error'
  | 'server-error'
  | 'no-http-response'
  | 'http-response';

type ProtocolLabel = Readonly<{ article: 'a' | 'an'; label: string }>;

const PROTOCOL_LABELS: Readonly<Record<string, ProtocolLabel>> = Object.freeze({
  static: { article: 'a', label: 'static asset' },
  document: { article: 'a', label: 'document' },
  'fetch-xhr': { article: 'a', label: 'fetch/XHR' },
  api: { article: 'an', label: 'API' },
  graphql: { article: 'a', label: 'GraphQL' },
  form: { article: 'a', label: 'form' },
  'next-api': { article: 'a', label: 'probable Next.js API' },
  'next-server-action': { article: 'a', label: 'Server Action' },
  ssr: { article: 'an', label: 'SSR document' },
  rsc: { article: 'an', label: 'RSC' },
  unknown: { article: 'an', label: 'unknown' },
});

function headerValue(
  headers: readonly Header[],
  searchedName: string,
): string | undefined {
  const lowerName = searchedName.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lowerName)?.value;
}

function protocolLabel(classification: Classification): ProtocolLabel {
  return (
    PROTOCOL_LABELS[classification.kind] ?? {
      article: 'a',
      label: classification.kind,
    }
  );
}

function outcome(status: number): Outcome {
  if (status === 0) return 'no-http-response';
  if (status >= 200 && status <= 299) return 'success';
  if (status >= 300 && status <= 399) return 'redirect';
  if (status >= 400 && status <= 499) return 'client-error';
  if (status >= 500) return 'server-error';
  return 'http-response';
}

/**
 * HAR reports sub-microsecond floats such as 123.45600000000002. Durations are
 * evidence shown to a person, so they are stated at whole-millisecond
 * resolution rather than at the precision of the source float.
 */
function durationLabel(totalMs: number): string {
  return Number.isFinite(totalMs) ? String(Math.round(totalMs)) : '0';
}

function outcomeSentence(status: number, durationMs: number, result: Outcome): string {
  const duration = durationLabel(durationMs);
  if (result === 'no-http-response') {
    return `It failed before an HTTP response was captured after ${duration} ms.`;
  }
  const statusLabel: Readonly<Partial<Record<Outcome, string>>> = {
    success: 'success',
    redirect: 'redirection',
    'client-error': 'client error',
    'server-error': 'server error',
  };
  const label = statusLabel[result];
  return `It completed with HTTP ${status}${label === undefined ? '' : ` (${label})`} in ${duration} ms.`;
}

function normalizedUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function repeatedCount(
  request: CapturedRequest,
  related: readonly CapturedRequest[],
): number {
  const normalized = normalizedUrl(request.url);
  if (normalized === undefined) return 0;
  const method = request.method.toUpperCase();
  return related.filter(
    (candidate) =>
      candidate.id !== request.id &&
      candidate.method.toUpperCase() === method &&
      normalizedUrl(candidate.url) === normalized,
  ).length;
}

function makeExplanation(
  result: Outcome,
  summary: readonly string[],
  guidance: readonly string[],
  evidence: readonly string[],
): Explanation {
  return Object.freeze({
    outcome: result,
    summary: summary.join(' '),
    guidance: Object.freeze([...guidance]),
    evidence: Object.freeze([...evidence]),
  });
}

export function explainRequest(
  request: CapturedRequest,
  related: readonly CapturedRequest[],
): Explanation {
  const classification = request.classification ?? classifyRequest(request);
  const protocol = protocolLabel(classification);
  const initiator = request.evidence.initiator?.trim();
  const trigger = initiator || 'The browser';
  const result = outcome(request.response.status);
  const summary = [
    initiator === undefined || initiator.length === 0
      ? `The browser recorded ${protocol.article} ${protocol.label} request.`
      : `${trigger} was recorded as the initiator for ${protocol.article} ${protocol.label} request.`,
    outcomeSentence(request.response.status, request.timing.totalMs, result),
  ];
  const guidance: string[] = [];
  const evidence = [
    ...(initiator === undefined || initiator.length === 0
      ? []
      : [`Initiator: ${initiator}.`]),
    `Classification: ${protocol.label} (${classification.confidence}).`,
    request.response.status === 0
      ? 'HTTP status: no response captured.'
      : `HTTP status: ${request.response.status}.`,
    `Duration: ${durationLabel(request.timing.totalMs)} ms.`,
  ];

  if (request.evidence.redirectUrl !== undefined) {
    summary.push(`The response redirects to ${request.evidence.redirectUrl}.`);
    evidence.push(`Redirect target: ${request.evidence.redirectUrl}.`);
  }
  if (request.evidence.fromCache === true) {
    summary.push('The response was served from browser cache.');
    evidence.push('Cache evidence: browser cache.');
  }
  if (request.evidence.fromServiceWorker === true) {
    summary.push('A service worker supplied the response.');
    evidence.push('Service worker evidence: response fetched via service worker.');
  }

  const reason = request.response.body.reason ?? '';
  const hasCorsEvidence = /\bcors\b/i.test(reason);
  const hasCspEvidence = /\bcsp\b|content-security-policy/i.test(reason);
  if (hasCorsEvidence) {
    summary.push('Direct capture evidence reports a CORS failure.');
    evidence.push('CORS evidence: response body reason reports CORS.');
  }
  if (hasCspEvidence) {
    summary.push('Direct capture evidence reports a CSP failure.');
    evidence.push('CSP evidence: response body reason reports CSP.');
  }

  const retryAttempt = headerValue(request.request.headers, 'x-retry-attempt')?.trim();
  if (retryAttempt) {
    summary.push(
      `Request header X-Retry-Attempt directly identifies retry attempt ${retryAttempt}.`,
    );
    evidence.push(`Retry evidence: X-Retry-Attempt=${retryAttempt}.`);
  }

  const repeats = repeatedCount(request, related);
  if (repeats > 0) {
    summary.push(
      `${repeats} related request${repeats === 1 ? '' : 's'} ${repeats === 1 ? 'has' : 'have'} the same method and normalized URL; this is a repeated call, not proof of a retry.`,
    );
    evidence.push(`Repeated call count: ${repeats}.`);
  }

  if (result === 'client-error') {
    guidance.push(
      'Check the request URL, parameters, and authorization for the client error.',
    );
  }
  if (result === 'server-error') {
    guidance.push('Inspect server logs and the response body for the server failure.');
  }
  if (result === 'no-http-response') {
    guidance.push(
      'Check the browser Network panel and server logs; no HTTP response was captured.',
    );
  }
  if (hasCorsEvidence) {
    guidance.push('Inspect the response CORS headers and the requesting origin.');
  }
  if (hasCspEvidence) {
    guidance.push(
      'Inspect the active Content-Security-Policy and blocked resource type.',
    );
  }
  if (repeats > 0) {
    guidance.push(
      'Compare the repeated calls to find changed headers, bodies, or timing.',
    );
  }
  if (request.timing.totalMs >= 1_000) {
    guidance.push(
      'Inspect the timing breakdown; this request took at least one second.',
    );
  }

  return makeExplanation(result, summary, guidance, evidence);
}
