import type { InteractionGroup } from '../../domain/model';
import type { SanitizedCapturedRequest } from '../../domain/sanitized';

const KIND_LABELS: Readonly<Record<string, string>> = {
  api: 'an API request',
  graphql: 'a GraphQL request',
  form: 'a form submission',
  'next-api': 'a likely Next.js API request',
  'next-server-action': 'a Server Action',
  ssr: 'an SSR document',
  rsc: 'an RSC payload',
  document: 'a document request',
  'fetch-xhr': 'a fetch/XHR request',
  static: 'a static asset request',
  unknown: 'a browser request',
};

function interactionLabel(group: InteractionGroup | null): string {
  if (group?.kind !== 'event') return 'The browser';
  const target = group.event.target;
  const value = target?.text ?? target?.name ?? target?.id;
  if (value !== undefined && value.trim() !== '') return value.trim();
  if (group.event.kind === 'navigation' || group.event.kind === 'history') {
    return 'Navigation';
  }
  return group.event.kind === 'submit' ? 'Form submission' : 'Page interaction';
}

function observationLead(group: InteractionGroup | null): string {
  if (group?.kind !== 'event') return 'Exhibit observed';
  return `After ${interactionLabel(group)}, Exhibit observed`;
}

function outcome(status: number): string {
  if (status === 0) return 'did not produce an HTTP response';
  if (status >= 200 && status < 300) return `succeeded with HTTP ${status}`;
  if (status >= 300 && status < 400) return `redirected with HTTP ${status}`;
  if (status >= 400 && status < 500) return `failed with client error HTTP ${status}`;
  if (status >= 500) return `failed with server error HTTP ${status}`;
  return `completed with HTTP ${status}`;
}

export function OutcomeSummary({
  group,
  request,
}: Readonly<{
  group: InteractionGroup | null;
  request: SanitizedCapturedRequest;
}>) {
  const classification = request.classification;
  const kind =
    KIND_LABELS[classification?.kind ?? 'unknown'] ??
    `a ${classification?.kind ?? 'browser'} request`;
  const duration = Math.round(request.timing.totalMs);
  const confidence = classification?.confidence ?? 'unknown';

  return (
    <header className="outcome-summary">
      <p className="eyebrow">What happened</p>
      <h2>
        {observationLead(group)} {kind} that {outcome(request.response.status)} in{' '}
        {duration} ms; classification confidence is {confidence}.
      </h2>
      <div className="outcome-summary__facts">
        <span className={`confidence confidence--${confidence}`}>
          {confidence} evidence
        </span>
        <span>HTTP {request.response.status || 'not captured'}</span>
        <span>{duration} ms total</span>
      </div>
    </header>
  );
}
