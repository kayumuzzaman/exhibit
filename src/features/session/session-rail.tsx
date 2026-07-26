import type { SanitizedRecordingSession } from '../../domain/sanitized';
import { Button } from '../../components/button';
import { Icon } from '../../components/icon';

export type QuickFilter = 'cacheHits' | 'failures' | 'slowCalls';
export type QuickFilterState = Readonly<Record<QuickFilter, boolean>>;

export function SessionRail({
  apiOnly,
  onApiOnlyChange,
  onClose,
  onQuickFilterChange,
  onResetFilters,
  quickFilters,
  session,
}: Readonly<{
  apiOnly: boolean;
  onApiOnlyChange(value: boolean): void;
  onClose?: () => void;
  onQuickFilterChange(filter: QuickFilter, value: boolean): void;
  onResetFilters(): void;
  quickFilters: QuickFilterState;
  session: SanitizedRecordingSession;
}>) {
  const percent = Math.min(
    100,
    Math.round((session.requests.length / session.limits.maxRequests) * 100),
  );
  return (
    <nav aria-label="Session workspace" className="session-rail">
      <div className="session-rail__heading">
        <div>
          <p className="eyebrow">Current session</p>
          <h2>Evidence ledger</h2>
        </div>
        {onClose === undefined ? null : (
          <Button aria-label="Close session rail" onClick={onClose} tone="quiet">
            <Icon name="back" />
          </Button>
        )}
      </div>

      <dl className="session-facts">
        <div>
          <dt>Requests</dt>
          <dd>{session.requests.length}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{session.retention === 'persistent' ? 'Local' : 'Memory'}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{percent}%</dd>
        </div>
      </dl>

      <div className="rail-section">
        <p className="eyebrow">
          <Icon name="filter" /> Filters
        </p>
        <label className="rail-check">
          <input
            checked={apiOnly}
            onChange={(event) => onApiOnlyChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>API requests only</strong>
            <small>Hide documents and static assets</small>
          </span>
        </label>
      </div>

      <div className="rail-section">
        <p className="eyebrow">Quick filters</p>
        <div className="quick-filter-list">
          {(
            [
              ['failures', 'Failures'],
              ['slowCalls', 'Slow calls'],
              ['cacheHits', 'Cache hits'],
            ] as const
          ).map(([filter, label]) => (
            <button
              aria-pressed={quickFilters[filter]}
              className="quick-filter-chip"
              key={filter}
              onClick={() => onQuickFilterChange(filter, !quickFilters[filter])}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <Button className="rail-reset" onClick={onResetFilters} tone="quiet">
          Reset filters
        </Button>
      </div>

      <div className="rail-section rail-section--end">
        <p className="eyebrow">Interaction groups</p>
        <p className="rail-copy">
          Browser interactions appear here when page access is available.
        </p>
      </div>
    </nav>
  );
}
