import { useState } from 'react';

import {
  CopyButton,
  type CopyFunction,
  type CopyResult,
} from '../../components/copy-button';
import { Tabs, type TabItem } from '../../components/tabs';
import { toSafeCurl } from '../../domain/curl';
import type { InteractionGroup } from '../../domain/model';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';
import { compareRequests, type RequestDiff } from '../session/compare-requests';
import { BodyViewer } from './body-viewer';
import { EvidenceList } from './evidence-list';
import { HeaderList } from './header-list';
import { RequestDiffView } from './request-diff';
import { TimingWaterfall } from './timing-waterfall';

type InspectTab =
  'overview' | 'request' | 'response' | 'timing' | 'initiator' | 'evidence';

function route(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function interactionText(group: InteractionGroup | null): string {
  if (group?.kind !== 'event') return 'No trusted interaction was correlated.';
  const target = group.event.target;
  const label = target?.text ?? target?.name ?? target?.id ?? target?.tag;
  return `${group.event.kind} · ${label ?? 'unlabeled target'} · ${group.event.trust}`;
}

export function InspectView({
  comparison,
  compareWith,
  copy,
  group = null,
  relatedRequests = [],
  request,
}: Readonly<{
  comparison?: RequestDiff;
  compareWith?: SanitizedCapturedRequest;
  copy?: CopyFunction;
  group?: InteractionGroup | null;
  relatedRequests?: readonly SanitizedCapturedRequest[];
  request: SanitizedCapturedRequest;
}>) {
  const [copyResult, setCopyResult] = useState<Readonly<{
    requestId: string;
    result: CopyResult;
  }> | null>(null);
  const [visibleComparisonKey, setVisibleComparisonKey] = useState<string | null>(null);
  // A copy outcome describes one request, so it must not survive a new selection.
  const visibleCopyResult =
    copyResult?.requestId === request.id ? copyResult.result : null;
  const comparisonKey =
    comparison === undefined
      ? compareWith === undefined
        ? null
        : JSON.stringify(['computed', compareWith.id, request.id])
      : JSON.stringify(['provided', request.id]);
  const showComparison =
    comparisonKey !== null && visibleComparisonKey === comparisonKey;
  const visibleComparison =
    comparison ??
    (showComparison && compareWith !== undefined
      ? compareRequests(compareWith, request)
      : null);

  function onCopyResult(result: CopyResult): void {
    setCopyResult({ requestId: request.id, result });
  }

  function toggleComparison(): void {
    if (comparisonKey === null) return;
    setVisibleComparisonKey(showComparison ? null : comparisonKey);
  }

  const overview = (
    <section className="inspect-section overview-evidence">
      <dl className="evidence-grid">
        <div>
          <dt>Method</dt>
          <dd>{request.method}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{request.response.status || 'No response'}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{Math.round(request.timing.totalMs)} ms</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{request.classification?.kind ?? 'unknown'}</dd>
        </div>
      </dl>
      <div className="inspect-url">
        <span>Sanitized URL</span>
        <code>{route(request.url)}</code>
      </div>
      {comparison === undefined && compareWith === undefined ? null : (
        <button className="text-action" onClick={toggleComparison} type="button">
          {showComparison ? 'Hide request comparison' : 'Show request comparison'}
        </button>
      )}
      {showComparison &&
      visibleComparison !== undefined &&
      visibleComparison !== null ? (
        <RequestDiffView diff={visibleComparison} />
      ) : null}
    </section>
  );
  const requestEvidence = (
    <div className="inspect-stack">
      <section className="inspect-section">
        <div className="inspect-section__heading">
          <p className="eyebrow">Request headers</p>
          <h3>Sent headers</h3>
        </div>
        <HeaderList
          {...(copy === undefined ? {} : { copy })}
          headers={request.request.headers}
          onCopyResult={onCopyResult}
        />
      </section>
      {request.request.body === undefined ? (
        <p className="body-state">No request body was captured.</p>
      ) : (
        <section className="inspect-section">
          <div className="inspect-section__heading">
            <p className="eyebrow">Request body</p>
            <h3>Captured payload</h3>
          </div>
          <BodyViewer body={request.request.body} key={request.id} />
        </section>
      )}
    </div>
  );
  const responseEvidence = (
    <div className="inspect-stack">
      <section className="inspect-section">
        <div className="inspect-section__heading">
          <p className="eyebrow">Response headers</p>
          <h3>
            HTTP {request.response.status || 'not captured'}{' '}
            {request.response.statusText ?? ''}
          </h3>
        </div>
        <HeaderList
          {...(copy === undefined ? {} : { copy })}
          headers={request.response.headers}
          onCopyResult={onCopyResult}
        />
      </section>
      <section className="inspect-section">
        <div className="inspect-section__heading">
          <p className="eyebrow">Response body</p>
          <h3>Captured result</h3>
        </div>
        <BodyViewer body={request.response.body} key={request.id} />
      </section>
    </div>
  );
  const tabs: readonly TabItem<InspectTab>[] = [
    { id: 'overview', label: 'Overview', content: overview },
    { id: 'request', label: 'Request', content: requestEvidence },
    { id: 'response', label: 'Response', content: responseEvidence },
    {
      id: 'timing',
      label: 'Timing',
      content: (
        <section className="inspect-section">
          <div className="inspect-section__heading">
            <p className="eyebrow">HAR timing</p>
            <h3>Phase breakdown</h3>
          </div>
          <TimingWaterfall timing={request.timing} />
        </section>
      ),
    },
    {
      id: 'initiator',
      label: 'Initiator',
      content: (
        <section className="inspect-section initiator-evidence">
          <p className="eyebrow">Interaction correlation</p>
          <h3>{interactionText(group)}</h3>
          <p>
            {request.evidence.initiator ??
              'Chrome did not expose a normalized initiator label.'}
          </p>
        </section>
      ),
    },
    {
      id: 'evidence',
      label: 'Evidence',
      content: <EvidenceList relatedRequests={relatedRequests} request={request} />,
    },
  ];

  return (
    <article aria-label="Normalized request inspector" className="inspect-view">
      <div className="inspect-toolbar">
        <div>
          <p className="eyebrow">Developer evidence</p>
          <h2>{route(request.url)}</h2>
        </div>
        <CopyButton
          {...(copy === undefined ? {} : { copy })}
          errorMessage="Safe cURL could not be copied. Clipboard unavailable."
          label="Copy safe cURL"
          onResult={onCopyResult}
          successMessage="Safe cURL copied."
          value={toSafeCurl(request)}
        />
      </div>
      {visibleCopyResult === null ? null : (
        <p
          className={`copy-result copy-result--${visibleCopyResult.tone}`}
          role={visibleCopyResult.tone === 'error' ? 'alert' : 'status'}
        >
          {visibleCopyResult.message}
        </p>
      )}
      <Tabs
        defaultActiveId="overview"
        label="Inspect request evidence"
        tabs={tabs}
        variant="evidence"
      />
    </article>
  );
}
