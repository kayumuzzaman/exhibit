import type { BodyContent, InteractionGroup } from '../../domain/model';
import { explainRequest } from '../../domain/explanation';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';
import { Guidance } from './guidance';
import { OutcomeSummary } from './outcome-summary';
import { RelatedRequests } from './related-requests';

const MAX_EXPLAIN_BODY_BYTES = 64 * 1_024;

function jsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function submittedFields(body: BodyContent | undefined): readonly string[] {
  if (body === undefined || body.capturedSize > MAX_EXPLAIN_BODY_BYTES) return [];
  if (body.text === undefined) return [];
  const json = jsonObject(body.text);
  if (json !== undefined) return Object.keys(json).sort();
  const mime = body.mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mime === 'application/x-www-form-urlencoded') {
    return [...new Set([...new URLSearchParams(body.text).keys()])].sort();
  }
  if (mime?.startsWith('multipart/form-data') === true) {
    return [
      ...new Set(
        [...body.text.matchAll(/content-disposition:[^\r\n]*\bname="([^"]+)"/giu)]
          .map((match) => match[1])
          .filter((name): name is string => name !== undefined),
      ),
    ].sort();
  }
  return [];
}

function resultSummary(body: BodyContent): string {
  if (body.state === 'binary') return `Binary result, ${body.size} bytes.`;
  if (body.state === 'streamed') return 'Streamed result was not buffered.';
  if (body.state === 'unavailable') return 'Response body was unavailable.';
  if (body.capturedSize > MAX_EXPLAIN_BODY_BYTES) {
    return 'Large body shape is available in Inspect; content was not decoded here.';
  }
  const parsed = jsonObject(body.text);
  if (parsed !== undefined) {
    const fields = Object.keys(parsed).sort();
    return `JSON result with ${fields.length} field${fields.length === 1 ? '' : 's'}${fields.length === 0 ? '.' : `: ${fields.join(', ')}.`}`;
  }
  if (body.text === undefined || body.text === '')
    return 'No captured response content.';
  return `Text result captured${body.state === 'truncated' ? ' in part' : ''}, ${body.capturedSize} bytes.`;
}

export function ExplainView({
  group = null,
  relatedRequests = [],
  request,
}: Readonly<{
  group?: InteractionGroup | null;
  relatedRequests?: readonly SanitizedCapturedRequest[];
  request: SanitizedCapturedRequest;
}>) {
  const explanation = explainRequest(request, relatedRequests);
  const fields = submittedFields(request.request.body);

  return (
    <article aria-label="Plain-language request explanation" className="explain-view">
      <OutcomeSummary group={group} request={request} />
      <div aria-hidden="true" className="evidence-spine" />
      <div className="explain-view__body">
        {request.classification?.actionId === undefined ? null : (
          <section className="explain-section action-evidence">
            <p className="eyebrow">Action identifier</p>
            <h3>{request.classification.actionId}</h3>
            <p>Confirmed by protocol evidence. No source-code label is inferred.</p>
          </section>
        )}
        <section aria-labelledby="submitted-heading" className="explain-section">
          <p className="eyebrow">Submitted shape</p>
          <h3 id="submitted-heading">Fields sent</h3>
          {fields.length === 0 ? (
            <p>No safe submitted field names were available.</p>
          ) : (
            <ul className="field-token-list">
              {fields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="result-heading" className="explain-section">
          <p className="eyebrow">Returned shape</p>
          <h3 id="result-heading">Result</h3>
          <p>{resultSummary(request.response.body)}</p>
        </section>
        <RelatedRequests relatedRequests={relatedRequests} request={request} />
        <Guidance explanation={explanation} request={request} />
        <details className="explain-evidence">
          <summary>Why Payloadra says this</summary>
          <ul>
            {explanation.evidence.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}
