import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';

import type { SanitizedCapturedRequest } from '../../domain/sanitized';
import { EmptyState } from './empty-state';

export type RequestTableProps = Readonly<{
  /**
   * Drops the secondary Kind, Source, and Evidence columns so Time, Method,
   * Route, Status, and Duration stay readable when the ledger is narrower than
   * the full eight-column table. Those three facts remain available in the
   * detail workspace and in the evidence facets.
   */
  compact?: boolean;
  emptyReason?: 'no-matches' | 'recording-empty';
  onSelect(request: SanitizedCapturedRequest): void;
  phone?: boolean;
  requests: readonly SanitizedCapturedRequest[];
  scrollPosition?: MutableRefObject<Readonly<{ left: number; top: number }>>;
  selectedId: string | null;
}>;

function route(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function source(request: SanitizedCapturedRequest): string {
  if (request.evidence.fromServiceWorker === true) return 'Service worker';
  if (request.evidence.fromCache === true) return 'Cache';
  return 'Network';
}

function evidence(request: SanitizedCapturedRequest): string[] {
  const states: string[] = [];
  if (request.response.body.state === 'unavailable') states.push('Body unavailable');
  if (request.response.body.state === 'truncated') states.push('Body truncated');
  if (request.evidence.redirectUrl !== undefined) states.push('Redirect');
  if (request.classification?.confidence === 'likely') states.push('Likely');
  return states.length === 0 ? ['Captured'] : states;
}

function duration(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function clock(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Date(value).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function RequestTable({
  compact = false,
  emptyReason,
  onSelect,
  phone = false,
  requests,
  scrollPosition,
  selectedId,
}: RequestTableProps) {
  const secondary = !phone && !compact;
  const preferredIndex = Math.max(
    0,
    requests.findIndex(({ id }) => id === selectedId),
  );
  const [focusIndex, setFocusIndex] = useState(preferredIndex);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => requests.map(({ id }) => id).join('\n'), [requests]);

  useEffect(() => {
    setFocusIndex((current) => Math.min(current, Math.max(0, requests.length - 1)));
  }, [ids, requests.length]);

  useLayoutEffect(() => {
    if (scrollPosition === undefined || scrollerRef.current === null) return;
    scrollerRef.current.scrollLeft = scrollPosition.current.left;
    scrollerRef.current.scrollTop = scrollPosition.current.top;
  }, [scrollPosition]);

  if (requests.length === 0) {
    return (
      <EmptyState
        kind={emptyReason === 'no-matches' ? 'no-matches' : 'recording-empty'}
      />
    );
  }

  function moveTo(index: number): void {
    const next = Math.max(0, Math.min(requests.length - 1, index));
    setFocusIndex(next);
    rowRefs.current[next]?.focus();
  }

  function onRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
    request: SanitizedCapturedRequest,
  ): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(requests.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(request);
    }
  }

  return (
    <div
      className="request-table-wrap"
      onScroll={(event) => {
        if (scrollPosition === undefined) return;
        scrollPosition.current = {
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop,
        };
      }}
      ref={scrollerRef}
    >
      {/* Rows carry a roving tabindex, aria-selected, and arrow-key navigation,
          which is the grid pattern. A static table would leave assistive
          technology in browse mode, where those keys never reach the rows. */}
      <table
        aria-label="Captured requests"
        className={`request-table${phone ? ' request-table--phone' : ''}${
          compact && !phone ? ' request-table--compact' : ''
        }`}
        role="grid"
      >
        <thead>
          <tr>
            {phone ? null : (
              <th className="column-time" scope="col">
                Time
              </th>
            )}
            <th className="column-method" scope="col">
              Method
            </th>
            <th className="column-route" scope="col">
              Route
            </th>
            {secondary ? (
              <th className="column-kind" scope="col">
                Kind
              </th>
            ) : null}
            <th className="column-status" scope="col">
              Status
            </th>
            {phone ? null : (
              <th className="column-duration" scope="col">
                Duration
              </th>
            )}
            {secondary ? (
              <>
                <th className="column-source" scope="col">
                  Source
                </th>
                <th className="column-evidence" scope="col">
                  Evidence
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {requests.map((request, index) => (
            <tr
              aria-selected={request.id === selectedId}
              className="request-table__row"
              data-outcome={
                request.response.status >= 400
                  ? 'failure'
                  : request.response.status >= 300
                    ? 'redirect'
                    : 'success'
              }
              key={request.id}
              onClick={() => {
                setFocusIndex(index);
                onSelect(request);
              }}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => onRowKeyDown(event, index, request)}
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              tabIndex={index === focusIndex ? 0 : -1}
            >
              {phone ? null : (
                <td className="column-time mono muted">{clock(request.startedAt)}</td>
              )}
              <td className="column-method">
                <span className="method">{request.method}</span>
              </td>
              <td className="column-route route" title={request.url}>
                {route(request.url)}
              </td>
              {secondary ? (
                <td className="column-kind">
                  {request.classification?.kind ?? 'unknown'}
                </td>
              ) : null}
              <td className="column-status">
                <span className="status-code">{request.response.status || 'ERR'}</span>
              </td>
              {phone ? null : (
                <td className="column-duration mono">
                  {duration(request.timing.totalMs)}
                </td>
              )}
              {secondary ? (
                <>
                  <td className="column-source">{source(request)}</td>
                  <td className="column-evidence">
                    <span className="evidence-badges">
                      {evidence(request).map((label) => (
                        <span className="evidence-badge" key={label}>
                          {label}
                        </span>
                      ))}
                    </span>
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
