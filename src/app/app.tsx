import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Button } from '../components/button';
import { Dialog, ModalSurface } from '../components/dialog';
import { Icon } from '../components/icon';
import { ResizeSeparator } from '../components/resizable';
import type { RecordingPhase } from '../domain/model';
import { RESTRICTED_PAGE_ORIGIN } from '../domain/inspected-page';
import type { SanitizedCapturedRequest } from '../domain/sanitized';
import {
  FALLBACK_DEVTOOLS_THEME_SOURCE,
  type DevtoolsThemeSource,
} from '../devtools/theme';
import { filterRequests } from '../features/session/filter-requests';
import { SearchIndex } from '../features/session/search-index';
import { CommandBar, type ThemeMode } from '../features/session/command-bar';
import { EmptyState, type EmptyStateKind } from '../features/session/empty-state';
import { RequestTable } from '../features/session/request-table';
import type { RequestTableProps } from '../features/session/request-table';
import {
  SessionRail,
  type QuickFilter,
  type QuickFilterState,
} from '../features/session/session-rail';
import type { SessionController } from '../features/session/session-controller';
import {
  AppProvider,
  useExportEvidence,
  useSession,
  useSessionController,
} from './app-provider';
import { AppErrorBoundary } from './error-boundary';

type ViewportMode = 'medium' | 'narrow' | 'phone' | 'wide';
const NO_QUICK_FILTERS: QuickFilterState = {
  cacheHits: false,
  failures: false,
  slowCalls: false,
};
const WIDE_DETAIL_MIN = 300;
const WIDE_GUTTERS = 14;
const WIDE_LIST_MIN = 420;
const WIDE_LIST_MAX = 760;
const WIDE_RAIL_MIN = 200;
const WIDE_RAIL_MAX = 360;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wideColumns(
  viewportWidth: number,
  requestedRail: number,
  requestedList: number,
): Readonly<{ list: number; listMax: number; rail: number; railMax: number }> {
  let rail = clamp(requestedRail, WIDE_RAIL_MIN, WIDE_RAIL_MAX);
  let list = clamp(requestedList, WIDE_LIST_MIN, WIDE_LIST_MAX);
  const available = viewportWidth - WIDE_DETAIL_MIN - WIDE_GUTTERS;
  const overflow = Math.max(0, rail + list - available);
  list -= Math.min(overflow, list - WIDE_LIST_MIN);
  rail -= Math.max(0, rail + list - available);
  const railMax = clamp(available - list, WIDE_RAIL_MIN, WIDE_RAIL_MAX);
  const listMax = clamp(available - rail, WIDE_LIST_MIN, WIDE_LIST_MAX);
  return { list, listMax, rail, railMax };
}

function viewportMode(): ViewportMode {
  if (typeof window === 'undefined') return 'wide';
  if (window.innerWidth < 480) return 'phone';
  if (window.innerWidth < 720) return 'narrow';
  if (window.innerWidth < 1_100) return 'medium';
  return 'wide';
}

function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState(viewportMode);
  useEffect(() => {
    const update = () => setMode(viewportMode());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return mode;
}

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    if (window.matchMedia === undefined) return;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function phaseLabel(phase: RecordingPhase): string {
  switch (phase) {
    case 'recording':
      return 'Recording';
    case 'starting':
      return 'Starting recording';
    case 'stopping':
      return 'Stopping recording';
    case 'stopped':
      return 'Not recording';
  }
}

function requestRoute(request: SanitizedCapturedRequest): string {
  try {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return request.url;
  }
}

function DetailSlot({
  onBack,
  request,
}: Readonly<{
  onBack?: () => void;
  request: SanitizedCapturedRequest | null;
}>) {
  const bodyState = request?.response.body.state;
  return (
    <section aria-label="Request detail" className="detail-slot">
      <div className="region-heading detail-slot__heading">
        <div>
          <p className="eyebrow">Detail workspace</p>
          <h2>{request === null ? 'Select a request' : requestRoute(request)}</h2>
        </div>
        {onBack === undefined ? null : (
          <Button aria-label="Back to requests" onClick={onBack} tone="quiet">
            <Icon name="back" /> Requests
          </Button>
        )}
      </div>
      {request === null ? (
        <div className="detail-slot__empty">
          <span className="detail-slot__crosshair" />
          <h3>No evidence selected</h3>
          <p>Choose a request from the ledger to open its safe detail workspace.</p>
        </div>
      ) : (
        <div className="detail-slot__selected">
          <div className="detail-summary">
            <span className="method">{request.method}</span>
            <span>{request.response.status || 'ERR'}</span>
            <span>{Math.round(request.timing.totalMs)} ms</span>
          </div>
          {bodyState === 'unavailable' ? (
            <div className="notice notice--warning">
              <strong>Body unavailable</strong>
              <span>
                DevTools did not provide this body. Headers and timing remain usable.
              </span>
            </div>
          ) : null}
          {bodyState === 'truncated' ? (
            <div className="notice notice--warning">
              <strong>Body truncated</strong>
              <span>
                Showing the captured safe excerpt; the original response was larger.
              </span>
            </div>
          ) : null}
          <div className="detail-handoff">
            <p className="eyebrow">Safe evidence handoff</p>
            <h3>Sanitized request ready</h3>
            <p>
              Timing, response status, and available body evidence were sanitized before
              this local record was stored.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function emptyKind(
  phase: RecordingPhase,
  origin: string,
  warningCodes: ReadonlySet<string>,
): EmptyStateKind {
  if (origin === RESTRICTED_PAGE_ORIGIN) return 'restricted';
  if (warningCodes.has('interaction-start-failed')) return 'network-only';
  if (warningCodes.has('capture-failed')) return 'capture-failure';
  return phase === 'recording' ? 'recording-empty' : 'not-recording';
}

function Ledger({
  empty,
  onOpenRail,
  onSelect,
  phone,
  rawRequestCount,
  requests,
  search,
  scrollPosition,
  selected,
  setSearch,
  showRailButton,
}: Readonly<{
  empty: EmptyStateKind | null;
  onOpenRail(): void;
  onSelect(request: SanitizedCapturedRequest): void;
  phone: boolean;
  rawRequestCount: number;
  requests: readonly SanitizedCapturedRequest[];
  search: string;
  scrollPosition: NonNullable<RequestTableProps['scrollPosition']>;
  selected: SanitizedCapturedRequest | null;
  setSearch(value: string): void;
  showRailButton: boolean;
}>) {
  return (
    <section aria-label="Request ledger" className="request-ledger">
      <div className="ledger-tools">
        <div className="region-heading">
          <div>
            <p className="eyebrow">Live evidence</p>
            <h2>Request ledger</h2>
          </div>
          <span className="ledger-count">{requests.length} shown</span>
        </div>
        <div className="ledger-search">
          {showRailButton ? (
            <Button aria-label="Open session rail" onClick={onOpenRail} tone="quiet">
              <Icon name="menu" />
            </Button>
          ) : null}
          <label>
            <span className="sr-only">Search requests</span>
            <input
              aria-label="Search requests"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search route, status, evidence…"
              type="search"
              value={search}
            />
          </label>
        </div>
      </div>
      {empty === null ? (
        <RequestTable
          emptyReason={rawRequestCount > 0 ? 'no-matches' : 'recording-empty'}
          onSelect={onSelect}
          phone={phone}
          requests={requests}
          scrollPosition={scrollPosition}
          selectedId={selected?.id ?? null}
        />
      ) : (
        <EmptyState kind={empty} />
      )}
    </section>
  );
}

function PanelShell({
  devtoolsThemeSource,
}: Readonly<{ devtoolsThemeSource: DevtoolsThemeSource }>) {
  const session = useSession();
  const controller = useSessionController();
  const exportEvidence = useExportEvidence();
  const mode = useViewportMode();
  const reducedMotion = useReducedMotion();
  const resolvedDevtoolsTheme = useSyncExternalStore(
    devtoolsThemeSource.subscribe,
    devtoolsThemeSource.getSnapshot,
    devtoolsThemeSource.getSnapshot,
  );
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [apiOnly, setApiOnly] = useState(true);
  const [quickFilters, setQuickFilters] = useState<QuickFilterState>(NO_QUICK_FILTERS);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [railDrawer, setRailDrawer] = useState(false);
  const [dialog, setDialog] = useState<'clear' | 'export' | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState('');
  const [railWidth, setRailWidth] = useState(216);
  const [listWidth, setListWidth] = useState(640);
  const ledgerScroll = useRef<Readonly<{ left: number; top: number }>>({
    left: 0,
    top: 0,
  });

  const filtered = useMemo(
    () =>
      filterRequests(session.requests, {
        apiOnly,
        ...(quickFilters.failures ? { outcome: 'failure' as const } : {}),
        ...(quickFilters.slowCalls ? { slowOnly: true } : {}),
        ...(quickFilters.cacheHits ? { cache: 'hit' as const } : {}),
      }),
    [apiOnly, quickFilters, session.requests],
  );
  const visibleRequests = useMemo(() => {
    if (search.trim() === '') return filtered;
    const index = new SearchIndex();
    filtered.forEach((request) => index.add(request));
    return index.query(search);
  }, [filtered, search]);
  const selected = session.requests.find(({ id }) => id === selectedId) ?? null;
  const columns = wideColumns(window.innerWidth, railWidth, listWidth);
  const warningCodes = useMemo(
    () => new Set(session.warnings.map(({ code }) => code)),
    [session.warnings],
  );
  const empty =
    session.requests.length === 0
      ? emptyKind(session.phase, session.origin, warningCodes)
      : null;

  async function toggleRecording(): Promise<void> {
    setBusy(true);
    setActionError('');
    try {
      if (session.phase === 'recording' || session.phase === 'starting') {
        await controller.stop();
        setAnnouncement('Recording stopped.');
      } else {
        await controller.start();
        setAnnouncement('Recording');
      }
    } catch {
      setActionError('Capture stopped unexpectedly. Start recording again.');
      setAnnouncement('Capture failed.');
    } finally {
      setBusy(false);
    }
  }

  async function clearEvidence(): Promise<void> {
    setBusy(true);
    setActionError('');
    try {
      await controller.clear();
      setSelectedId(null);
      setMobileDetail(false);
      setDialog(null);
      setAnnouncement('Evidence cleared.');
    } catch {
      setActionError('Clear failed. Keep DevTools open and try again.');
      setAnnouncement('Clear failed.');
    } finally {
      setBusy(false);
    }
  }

  async function exportSafeEvidence(): Promise<void> {
    setBusy(true);
    setActionError('');
    try {
      await exportEvidence();
      setDialog(null);
      setAnnouncement('Sanitized evidence exported.');
    } catch {
      setActionError('Export failed. Keep the session open and try again.');
      setAnnouncement('Export failed.');
    } finally {
      setBusy(false);
    }
  }

  function select(request: SanitizedCapturedRequest): void {
    setSelectedId(request.id);
    setMobileDetail(true);
  }

  function changeQuickFilter(filter: QuickFilter, value: boolean): void {
    setQuickFilters((current) => ({ ...current, [filter]: value }));
  }

  function resetFilters(): void {
    setApiOnly(false);
    setQuickFilters(NO_QUICK_FILTERS);
    setSearch('');
  }

  const rail = (
    <SessionRail
      apiOnly={apiOnly}
      onApiOnlyChange={setApiOnly}
      onQuickFilterChange={changeQuickFilter}
      onResetFilters={resetFilters}
      quickFilters={quickFilters}
      session={session}
    />
  );

  const ledger = (
    <Ledger
      empty={empty}
      onOpenRail={() => setRailDrawer(true)}
      onSelect={select}
      phone={mode === 'phone'}
      rawRequestCount={session.requests.length}
      requests={visibleRequests}
      search={search}
      scrollPosition={ledgerScroll}
      selected={selected}
      setSearch={setSearch}
      showRailButton={mode !== 'wide'}
    />
  );
  const detail = (
    <DetailSlot
      {...(mode === 'narrow' || mode === 'phone'
        ? {
            onBack: () => {
              setMobileDetail(false);
            },
          }
        : {})}
      request={selected}
    />
  );
  const style = {
    '--detail-min': `${WIDE_DETAIL_MIN}px`,
    '--rail-width': `${columns.rail}px`,
    '--list-width': `${columns.list}px`,
  } as CSSProperties;

  let workspace: ReactNode;
  if (mode === 'wide') {
    workspace = (
      <div className="workspace workspace--wide" style={style}>
        {rail}
        <ResizeSeparator
          label="Resize session rail"
          max={columns.railMax}
          min={WIDE_RAIL_MIN}
          onChange={setRailWidth}
          value={columns.rail}
        />
        {ledger}
        <ResizeSeparator
          label="Resize request ledger"
          max={columns.listMax}
          min={WIDE_LIST_MIN}
          onChange={setListWidth}
          value={columns.list}
        />
        {detail}
      </div>
    );
  } else if (mode === 'medium') {
    workspace = (
      <div className="workspace workspace--medium">
        {ledger}
        {detail}
      </div>
    );
  } else {
    workspace = (
      <div className="workspace workspace--narrow">
        {selected !== null && mobileDetail ? detail : ledger}
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      data-recording={session.phase === 'recording'}
      data-reduced-motion={reducedMotion}
      data-devtools-theme={resolvedDevtoolsTheme}
      data-theme={theme}
    >
      <div className="app-background" inert={railDrawer ? true : undefined}>
        <CommandBar
          busy={busy}
          onClear={() => setDialog('clear')}
          onExport={() => setDialog('export')}
          onRecord={() => void toggleRecording()}
          onTheme={setTheme}
          origin={session.origin}
          phase={session.phase}
          theme={theme}
        />
        <div aria-atomic="true" className="sr-only" role="status">
          {announcement || phaseLabel(session.phase)}
        </div>

        {session.evictedCount > 0 ? (
          <div className="session-notice" role="note">
            <Icon name="archive" />
            {session.evictedCount} oldest requests were removed to keep this session
            within its storage limit.
          </div>
        ) : null}
        {warningCodes.has('interaction-start-failed') && session.requests.length > 0 ? (
          <div className="session-notice session-notice--warning" role="note">
            Network requests are still recording. Interaction grouping is unavailable.
          </div>
        ) : null}
        {warningCodes.has('capture-failed') && session.requests.length > 0 ? (
          <div className="session-notice session-notice--failure" role="alert">
            Capture stopped unexpectedly. Start recording again. Existing sanitized
            evidence remains available.
          </div>
        ) : null}
        {actionError === '' || dialog !== null ? null : (
          <div className="session-notice session-notice--failure" role="alert">
            {actionError}
          </div>
        )}

        {workspace}
      </div>

      {railDrawer ? (
        <ModalSurface
          backdropClassName="rail-drawer-backdrop"
          dismissOnBackdrop
          label="Session filters"
          onClose={() => setRailDrawer(false)}
          panelClassName="rail-drawer-panel"
        >
          <SessionRail
            apiOnly={apiOnly}
            onApiOnlyChange={setApiOnly}
            onClose={() => setRailDrawer(false)}
            onQuickFilterChange={changeQuickFilter}
            onResetFilters={resetFilters}
            quickFilters={quickFilters}
            session={session}
          />
        </ModalSurface>
      ) : null}

      {dialog === 'clear' ? (
        <Dialog
          description="This removes the current local evidence session. Recording stops first. This action cannot be undone."
          onClose={() => setDialog(null)}
          title="Clear captured evidence"
        >
          {actionError === '' ? null : (
            <p className="dialog__error" role="alert">
              {actionError}
            </p>
          )}
          <div className="dialog__actions">
            <Button data-initial-focus="" onClick={() => setDialog(null)}>
              Keep evidence
            </Button>
            <Button disabled={busy} onClick={() => void clearEvidence()} tone="danger">
              Clear evidence now
            </Button>
          </div>
        </Dialog>
      ) : null}

      {dialog === 'export' ? (
        <Dialog
          description="Only this sanitized session is exported. Authorization and cookies are always removed."
          onClose={() => setDialog(null)}
          title="Export sanitized evidence"
        >
          {actionError === '' ? null : (
            <p className="dialog__error" role="alert">
              {actionError}
            </p>
          )}
          <div className="dialog__actions">
            <Button data-initial-focus="" onClick={() => setDialog(null)}>
              Cancel export
            </Button>
            <Button
              disabled={busy}
              onClick={() => void exportSafeEvidence()}
              tone="primary"
            >
              Export sanitized file
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function PayloadraApp({
  controller,
  devtoolsTheme = FALLBACK_DEVTOOLS_THEME_SOURCE,
  exportEvidence,
}: Readonly<{
  controller: SessionController;
  devtoolsTheme?: DevtoolsThemeSource;
  exportEvidence?: () => Promise<void>;
}>) {
  return (
    <AppErrorBoundary
      controller={controller}
      {...(exportEvidence === undefined ? {} : { exportEvidence })}
    >
      <AppProvider
        controller={controller}
        {...(exportEvidence === undefined ? {} : { exportEvidence })}
      >
        <PanelShell devtoolsThemeSource={devtoolsTheme} />
      </AppProvider>
    </AppErrorBoundary>
  );
}
