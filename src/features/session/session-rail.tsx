import type { InteractionGroup, RetentionMode } from '../../domain/model';
import type { SanitizedRecordingSession } from '../../domain/sanitized';
import { Button } from '../../components/button';
import { Icon } from '../../components/icon';
import type { CacheFilter, RequestOutcome } from './filter-requests';

export type QuickFilter = 'cacheHits' | 'failures' | 'slowCalls';
export type QuickFilterState = Readonly<Record<QuickFilter, boolean>>;
export type FacetFilter = 'cache' | 'domain' | 'method' | 'outcome' | 'protocol';
export type FacetFilterState = Readonly<{
  cache: '' | CacheFilter;
  domain: string;
  method: string;
  outcome: '' | RequestOutcome;
  protocol: string;
}>;
export type FacetFilterOptions = Readonly<{
  domains: readonly string[];
  methods: readonly string[];
  protocols: readonly string[];
}>;

function groupLabel(group: InteractionGroup): string {
  if (group.kind === 'unattributed') return 'Unattributed';
  const target = group.event.target;
  const candidate = [target?.text, target?.name, target?.id, target?.tag].find(
    (value) => value !== undefined && value.trim() !== '',
  );
  return (
    candidate?.trim().replaceAll(/\s+/gu, ' ').slice(0, 80) ??
    (group.event.kind === 'submit' ? 'Form submission' : 'Page interaction')
  );
}

function groupCount(group: InteractionGroup): string {
  const count = group.requestIds.length;
  return `${count} ${count === 1 ? 'request' : 'requests'}`;
}

function groupMeta(group: InteractionGroup): string {
  if (group.kind === 'unattributed') return 'No trusted interaction';
  const trust = group.event.trust === 'trusted' ? 'Trusted' : 'Untrusted hint';
  const eventKind =
    group.event.kind.charAt(0).toUpperCase() + group.event.kind.slice(1);
  return `${eventKind} · ${trust}`;
}

export function SessionRail({
  apiOnly,
  facetFilters,
  facetOptions,
  groups,
  onApiOnlyChange,
  onClose,
  onFacetFilterChange,
  onGroupChange,
  onQuickFilterChange,
  onResetFilters,
  onRetentionChange,
  quickFilters,
  retentionBusy,
  retentionError,
  selectedGroupId,
  session,
}: Readonly<{
  apiOnly: boolean;
  facetFilters: FacetFilterState;
  facetOptions: FacetFilterOptions;
  groups: readonly InteractionGroup[];
  onApiOnlyChange(value: boolean): void;
  onClose?: () => void;
  onFacetFilterChange(filter: FacetFilter, value: string): void;
  onGroupChange(groupId: string | null): void;
  onQuickFilterChange(filter: QuickFilter, value: boolean): void;
  onResetFilters(): void;
  onRetentionChange(retention: RetentionMode): void;
  quickFilters: QuickFilterState;
  retentionBusy: boolean;
  retentionError: string;
  selectedGroupId: string | null;
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

      <div className="rail-section rail-section--retention">
        <label className="retention-control">
          <span>
            <strong>Evidence retention</strong>
            <small>
              {session.retention === 'persistent'
                ? 'Stays on this machine until Clear.'
                : 'Clears when this browser session ends.'}
            </small>
          </span>
          <select
            aria-label="Evidence retention"
            disabled={retentionBusy}
            onChange={(event) => onRetentionChange(event.target.value as RetentionMode)}
            value={session.retention}
          >
            <option value="ephemeral">Memory — browser session</option>
            <option value="persistent">Local — until Clear</option>
          </select>
          {retentionError === '' ? null : (
            <small className="retention-control__error" role="alert">
              {retentionError}
            </small>
          )}
        </label>
      </div>

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
        <details className="facet-filters">
          <summary>Evidence facets</summary>
          <div className="facet-filter-grid">
            <label>
              <span>Method</span>
              <select
                aria-label="Method"
                onChange={(event) => onFacetFilterChange('method', event.target.value)}
                value={facetFilters.method}
              >
                <option value="">All methods</option>
                {facetOptions.methods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Domain</span>
              <select
                aria-label="Domain"
                onChange={(event) => onFacetFilterChange('domain', event.target.value)}
                value={facetFilters.domain}
              >
                <option value="">All domains</option>
                {facetOptions.domains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Protocol</span>
              <select
                aria-label="Protocol"
                onChange={(event) =>
                  onFacetFilterChange('protocol', event.target.value)
                }
                value={facetFilters.protocol}
              >
                <option value="">All protocols</option>
                {facetOptions.protocols.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {protocol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Outcome</span>
              <select
                aria-label="Outcome"
                onChange={(event) => onFacetFilterChange('outcome', event.target.value)}
                value={facetFilters.outcome}
              >
                <option value="">All outcomes</option>
                <option value="success">Success</option>
                <option value="redirect">Redirect</option>
                <option value="failure">Failure</option>
              </select>
            </label>
            <label>
              <span>Cache</span>
              <select
                aria-label="Cache"
                onChange={(event) => onFacetFilterChange('cache', event.target.value)}
                value={facetFilters.cache}
              >
                <option value="">Any cache state</option>
                <option value="hit">Cache hit</option>
                <option value="miss">Cache miss</option>
              </select>
            </label>
          </div>
        </details>
        <Button className="rail-reset" onClick={onResetFilters} tone="quiet">
          Reset filters
        </Button>
      </div>

      <div className="rail-section rail-section--end">
        <p className="eyebrow">Interaction groups</p>
        {groups.length === 0 ? (
          <p className="rail-copy">
            Browser interactions appear here when page access is available.
          </p>
        ) : (
          <div className="interaction-group-list">
            <button
              aria-label={`All interactions · ${session.requests.length} ${
                session.requests.length === 1 ? 'request' : 'requests'
              }`}
              aria-pressed={selectedGroupId === null}
              className="interaction-group"
              onClick={() => onGroupChange(null)}
              type="button"
            >
              <span>
                <strong>All interactions</strong>
                <small>Full evidence ledger</small>
              </span>
              <b>{session.requests.length}</b>
            </button>
            {groups.map((group) => {
              const label = groupLabel(group);
              const count = groupCount(group);
              const meta = groupMeta(group);
              return (
                <button
                  aria-label={`${label} · ${meta} · ${count}`}
                  aria-pressed={selectedGroupId === group.id}
                  className="interaction-group"
                  key={group.id}
                  onClick={() => onGroupChange(group.id)}
                  type="button"
                >
                  <span>
                    <strong>{label}</strong>
                    <small>{meta}</small>
                  </span>
                  <b>{group.requestIds.length}</b>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
