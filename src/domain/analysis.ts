import { classifyRequest } from './classification';
import { explainRequest } from './explanation';
import type { Classification, Explanation } from './model';
import type { SanitizedCapturedRequest, SanitizedRecordingSession } from './sanitized';

const UNKNOWN_CLASSIFICATION: Classification = Object.freeze({
  kind: 'unknown',
  confidence: 'unknown',
  evidence: Object.freeze([]),
});

const UNKNOWN_EXPLANATION: Explanation = Object.freeze({
  outcome: 'unknown',
  summary: 'Request analysis was unavailable.',
  guidance: Object.freeze([]),
  evidence: Object.freeze([]),
});

function analyzed(
  request: SanitizedCapturedRequest,
  related: readonly SanitizedCapturedRequest[],
): SanitizedCapturedRequest {
  let classification: Classification;
  try {
    classification = classifyRequest(request);
  } catch {
    classification = UNKNOWN_CLASSIFICATION;
  }
  const classified = { ...request, classification };
  let explanation: Explanation;
  try {
    explanation = explainRequest(classified, related);
  } catch {
    explanation = UNKNOWN_EXPLANATION;
  }
  return { ...classified, explanation };
}

/**
 * Recovered sessions intentionally discard stored analysis, so classification
 * and explanation are recomputed from the sanitized evidence. Without this the
 * ledger's API-first default would hide every recovered request.
 */
export function withRecoveredAnalysis(
  session: SanitizedRecordingSession,
): SanitizedRecordingSession {
  const related: SanitizedCapturedRequest[] = [];
  const requests = session.requests.map((request) => {
    const next = analyzed(request, related);
    related.push(next);
    return next;
  });
  return { ...session, requests };
}
