import type { Explanation } from '../../domain/model';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';

export function Guidance({
  explanation,
  request,
}: Readonly<{
  explanation: Explanation;
  request: SanitizedCapturedRequest;
}>) {
  const reason = request.response.body.reason ?? '';
  const ambiguous =
    request.response.status === 0 &&
    !/\bcors\b|\bcsp\b|content-security-policy/iu.test(reason);
  const guidance = [
    ...explanation.guidance,
    ...(ambiguous
      ? [
          'Capture evidence does not identify the browser policy or network cause; the cause is unknown.',
        ]
      : []),
  ];

  return (
    <section aria-labelledby="guidance-heading" className="explain-section guidance">
      <p className="eyebrow">Next checks</p>
      <h3 id="guidance-heading">Follow the evidence</h3>
      {guidance.length === 0 ? (
        <p>No corrective action is indicated by the captured evidence.</p>
      ) : (
        <ol className="guidance__list">
          {guidance.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
