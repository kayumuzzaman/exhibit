import type { BodyDiff, RequestDiff, ValueDiff } from '../session/compare-requests';

const MAX_DIFF_ROWS = 100;

function compact(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : (JSON.stringify(value, null, 0) ?? String(value));
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function bodyRows(label: string, body: BodyDiff): ValueDiff[] {
  return body.changes
    .slice(0, MAX_DIFF_ROWS)
    .map((change) => ({ ...change, path: `${label}${change.path || '/'}` }));
}

export function RequestDiffView({ diff }: Readonly<{ diff: RequestDiff }>) {
  const delta = diff.durationMs.right - diff.durationMs.left;
  const bodyChanges = [
    ...bodyRows('request', diff.requestBody),
    ...bodyRows('', diff.responseBody),
  ].slice(0, MAX_DIFF_ROWS);
  const headerChanges = [...diff.requestHeaders, ...diff.responseHeaders].slice(
    0,
    MAX_DIFF_ROWS,
  );

  return (
    <section aria-label="Request comparison" className="request-diff" role="region">
      <div className="request-diff__summary">
        <p>
          <span>Status</span>
          <strong>
            {diff.status.left} → {diff.status.right}
          </strong>
        </p>
        <p>
          <span>Duration</span>
          <strong>
            {delta === 0
              ? 'No change'
              : `${Math.abs(delta)} ms ${delta < 0 ? 'faster' : 'slower'}`}
          </strong>
        </p>
      </div>
      {headerChanges.length === 0 ? null : (
        <div className="request-diff__group">
          <h4>Changed headers</h4>
          <ul>
            {headerChanges.map((header, index) => (
              <li key={`${header.name}-${index}`}>
                <code>{header.name}</code>
                <span>
                  {header.left.map(compact).join(', ') || '—'} →{' '}
                  {header.right.map(compact).join(', ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="request-diff__group">
        <h4>Body structure</h4>
        {bodyChanges.length === 0 ? (
          <p>No body structure changed.</p>
        ) : (
          <ul>
            {bodyChanges.map((change, index) => (
              <li className={`diff-${change.kind}`} key={`${change.path}-${index}`}>
                <span className="diff-marker">{change.kind}</span>
                <code>{change.path}</code>
                <span>
                  {change.left === undefined ? '—' : compact(change.left)} →{' '}
                  {change.right === undefined ? '—' : compact(change.right)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {diff.requestBody.changes.length + diff.responseBody.changes.length >
      MAX_DIFF_ROWS ? (
        <p className="body-state body-state--warning">
          Comparison limited to first {MAX_DIFF_ROWS} body changes.
        </p>
      ) : null}
    </section>
  );
}
