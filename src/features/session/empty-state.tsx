import type { ReactNode } from 'react';

export type EmptyStateKind =
  | 'capture-failure'
  | 'network-only'
  | 'no-matches'
  | 'not-recording'
  | 'recording-empty'
  | 'restricted';

const COPY: Readonly<
  Record<EmptyStateKind, Readonly<{ title: string; detail: string }>>
> = {
  'capture-failure': {
    title: 'Capture stopped unexpectedly',
    detail: 'Start recording again. Existing sanitized evidence remains available.',
  },
  'network-only': {
    title: 'Network-only recording',
    detail:
      'Network requests are still recording. Reload after granting page interaction access.',
  },
  'no-matches': {
    title: 'No requests match these filters',
    detail: 'Clear search or filters to return to the full evidence ledger.',
  },
  'not-recording': {
    title: 'No capture in progress',
    detail: 'Start recording to collect browser-visible requests from this page.',
  },
  'recording-empty': {
    title: 'Recording is live',
    detail: 'Waiting for browser-visible API calls. Use the inspected page normally.',
  },
  restricted: {
    title: 'This page is restricted',
    detail:
      'Chrome pages cannot be inspected. Open a regular web page, then start recording.',
  },
};

export function EmptyState({
  action,
  kind,
}: Readonly<{ action?: ReactNode; kind: EmptyStateKind }>) {
  const copy = COPY[kind];
  return (
    <div className="empty-state" data-empty-kind={kind}>
      <span aria-hidden="true" className="empty-state__trace" />
      <p className="empty-state__eyebrow">Evidence state</p>
      <h2>{copy.title}</h2>
      <p>{copy.detail}</p>
      {action}
    </div>
  );
}
