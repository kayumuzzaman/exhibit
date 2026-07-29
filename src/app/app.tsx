import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button } from '../components/button';
import { Dialog, ModalSurface } from '../components/dialog';
import { ExportDialog, type EvidenceExportFormat } from '../components/export-dialog';
import { Icon } from '../components/icon';
import { ResizeSeparator } from '../components/resizable';
import { Tabs, type TabItem } from '../components/tabs';
import { correlate } from '../domain/correlation';
import type { InteractionGroup, RecordingPhase, RetentionMode } from '../domain/model';
import { RESTRICTED_PAGE_ORIGIN } from '../domain/inspected-page';
import type { SanitizedCapturedRequest } from '../domain/sanitized';
import {
  FALLBACK_DEVTOOLS_THEME_SOURCE,
  type DevtoolsThemeSource,
} from '../devtools/theme';
import { filterRequests } from '../features/session/filter-requests';
import { ExplainView } from '../features/explain/explain-view';
import { InspectView, type InspectTab } from '../features/inspect/inspect-view';
import { SearchIndex } from '../features/session/search-index';
import { CommandBar, type ThemeMode } from '../features/session/command-bar';
import { EmptyState, type EmptyStateKind } from '../features/session/empty-state';
import { RequestTable } from '../features/session/request-table';
import type { RequestTableProps } from '../features/session/request-table';
import {
  SessionRail,
  type FacetFilter,
  type FacetFilterOptions,
  type FacetFilterState,
  type QuickFilter,
  type QuickFilterState,
} from '../features/session/session-rail';
import type { SessionController } from '../features/session/session-controller';
import {
  DEFAULT_PAYLOADRA_SETTINGS,
  parseCustomFieldNames,
  type PayloadraSettingsService,
} from '../features/settings/payloadra-settings';
import {
  AppProvider,
  useExportEvidence,
  useSession,
  useSessionController,
} from './app-provider';
import { AppErrorBoundary } from './error-boundary';

type ViewportMode = 'medium' | 'narrow' | 'phone' | 'wide';
/** The ledger opens API-first; Reset clears every filter, including this one. */
const API_ONLY_DEFAULT = true;
const NO_QUICK_FILTERS: QuickFilterState = {
  cacheHits: false,
  failures: false,
  slowCalls: false,
};
const NO_FACET_FILTERS: FacetFilterState = {
  cache: '',
  domain: '',
  method: '',
  outcome: '',
  protocol: '',
};
const WIDE_DETAIL_MIN = 300;
const WIDE_GUTTERS = 14;
const WIDE_LIST_MIN = 420;
const WIDE_LIST_MAX = 900;
const WIDE_RAIL_MIN = 200;
const WIDE_RAIL_MAX = 360;

const DEFAULT_SETTINGS_SERVICE: PayloadraSettingsService = {
  initial: DEFAULT_PAYLOADRA_SETTINGS,
  async saveCustomFieldNames(customFieldNames) {
    return { ...DEFAULT_PAYLOADRA_SETTINGS, customFieldNames };
  },
  async saveTheme(theme) {
    return { ...DEFAULT_PAYLOADRA_SETTINGS, theme };
  },
};

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

const DEFAULT_VIEWPORT_WIDTH = 1_440;

/**
 * The eight-column ledger needs this much room. Below it the table would clip
 * or scroll horizontally, so the secondary Kind, Source, and Evidence columns
 * step aside and the five facts a triage pass needs stay whole. The default
 * ledger width sits above this, so a full-width panel loses nothing.
 */
const LEDGER_FULL_COLUMNS_MIN = 780;

function ledgerIsCompact(mode: ViewportMode, listWidth: number): boolean {
  if (mode === 'phone') return false;
  if (mode === 'wide') return listWidth < LEDGER_FULL_COLUMNS_MIN;
  return true;
}

function viewportModeFor(width: number): ViewportMode {
  if (width < 480) return 'phone';
  if (width < 720) return 'narrow';
  if (width < 1_100) return 'medium';
  return 'wide';
}

/**
 * The wide layout sizes its columns in pixels against the viewport, so the
 * width itself is state. Tracking only the breakpoint band would let React bail
 * out of a same-value update and leave the column maths stale after a resize.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth,
  );
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
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

function normalizedRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function previousRepeatedRequest(
  request: SanitizedCapturedRequest | null,
  requests: readonly SanitizedCapturedRequest[],
  selectedIndex: number,
): SanitizedCapturedRequest | undefined {
  if (request === null || selectedIndex <= 0) return undefined;
  const method = request.method.toUpperCase();
  const url = normalizedRequestUrl(request.url);
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const candidate = requests[index];
    if (
      candidate !== undefined &&
      candidate.method.toUpperCase() === method &&
      normalizedRequestUrl(candidate.url) === url
    ) {
      return candidate;
    }
  }
  return undefined;
}

function DetailSlot({
  activeMode,
  compareWith,
  containerRef,
  group,
  hasRequests,
  onBack,
  onInspectTabChange,
  onModeChange,
  relatedRequests,
  request,
  inspectTab,
}: Readonly<{
  activeMode: 'explain' | 'inspect';
  compareWith?: SanitizedCapturedRequest;
  containerRef?: RefObject<HTMLElement | null>;
  group: InteractionGroup | null;
  hasRequests: boolean;
  inspectTab: InspectTab;
  onBack?: () => void;
  onInspectTabChange(tab: InspectTab): void;
  onModeChange(mode: 'explain' | 'inspect'): void;
  relatedRequests: readonly SanitizedCapturedRequest[];
  request: SanitizedCapturedRequest | null;
}>) {
  const bodyState = request?.response.body.state;
  return (
    <section
      aria-label="Request detail"
      className="detail-slot"
      ref={containerRef}
      tabIndex={-1}
    >
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
          {/* When the ledger itself is empty it already explains the session
              state, so this pane stays quiet instead of competing with it. */}
          {hasRequests ? (
            <>
              <h3>No evidence selected</h3>
              <p>Choose a request from the ledger to open its safe detail workspace.</p>
            </>
          ) : (
            <p>Request detail opens here once the ledger has evidence.</p>
          )}
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
          <Tabs
            activeId={activeMode}
            defaultActiveId="explain"
            label="Request detail workspace"
            onChange={onModeChange}
            tabs={
              [
                {
                  id: 'explain',
                  label: 'Explain',
                  content: (
                    <ExplainView
                      group={group}
                      relatedRequests={relatedRequests}
                      request={request}
                    />
                  ),
                },
                {
                  id: 'inspect',
                  label: 'Inspect',
                  content: (
                    <InspectView
                      activeTab={inspectTab}
                      {...(compareWith === undefined ? {} : { compareWith })}
                      group={group}
                      onTabChange={onInspectTabChange}
                      relatedRequests={relatedRequests}
                      request={request}
                    />
                  ),
                },
              ] satisfies readonly TabItem<'explain' | 'inspect'>[]
            }
            variant="segmented"
          />
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
  // A stopped capture outranks degraded interaction access: claiming recording
  // continues would be false once capture itself has failed.
  if (warningCodes.has('capture-failed')) return 'capture-failure';
  if (warningCodes.has('interaction-start-failed')) return 'network-only';
  return phase === 'recording' ? 'recording-empty' : 'not-recording';
}

function storageWarning(warningCodes: ReadonlySet<string>): string | null {
  if (warningCodes.has('corrupt-session')) {
    return 'Stored evidence could not be read. Original local data is retained. Clear evidence to remove it.';
  }
  if (warningCodes.has('migration-cleanup-failed')) {
    return 'Storage mode cleanup failed. Clear evidence to remove residual local data.';
  }
  if (warningCodes.has('persistence-disabled')) {
    return 'Local recovery is unavailable after a storage failure. New evidence remains in this open panel.';
  }
  if (warningCodes.has('migration-failed')) {
    return 'Storage mode was not changed. Existing evidence remains in its previous location.';
  }
  return null;
}

function Ledger({
  empty,
  onOpenRail,
  compact,
  onRecord,
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
  compact: boolean;
  empty: EmptyStateKind | null;
  onOpenRail(): void;
  onRecord?: () => void;
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
          compact={compact}
          emptyReason={rawRequestCount > 0 ? 'no-matches' : 'recording-empty'}
          onSelect={onSelect}
          phone={phone}
          requests={requests}
          scrollPosition={scrollPosition}
          selectedId={selected?.id ?? null}
        />
      ) : (
        <EmptyState
          kind={empty}
          {...(empty === 'not-recording' && onRecord !== undefined
            ? {
                action: (
                  // Named so it never reads as the command bar's Start control:
                  // one visible label, and no substring collision for assistive
                  // technology or for locators.
                  <Button onClick={onRecord} tone="primary">
                    <Icon name="record" /> Record this page
                  </Button>
                ),
              }
            : {})}
        />
      )}
    </section>
  );
}

function PanelShell({
  devtoolsThemeSource,
  settingsService,
}: Readonly<{
  devtoolsThemeSource: DevtoolsThemeSource;
  settingsService: PayloadraSettingsService;
}>) {
  const session = useSession();
  const controller = useSessionController();
  const exportEvidence = useExportEvidence();
  const viewportWidth = useViewportWidth();
  const mode = viewportModeFor(viewportWidth);
  const reducedMotion = useReducedMotion();
  const resolvedDevtoolsTheme = useSyncExternalStore(
    devtoolsThemeSource.subscribe,
    devtoolsThemeSource.getSnapshot,
    devtoolsThemeSource.getSnapshot,
  );
  const [theme, setTheme] = useState<ThemeMode>(settingsService.initial.theme);
  const [customFieldNames, setCustomFieldNames] = useState<readonly string[]>(
    settingsService.initial.customFieldNames,
  );
  const [customFieldDraft, setCustomFieldDraft] = useState(
    settingsService.initial.customFieldNames.join('\n'),
  );
  const [apiOnly, setApiOnly] = useState(API_ONLY_DEFAULT);
  const [quickFilters, setQuickFilters] = useState<QuickFilterState>(NO_QUICK_FILTERS);
  const [facetFilters, setFacetFilters] = useState<FacetFilterState>(NO_FACET_FILTERS);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'explain' | 'inspect'>('explain');
  const [inspectTab, setInspectTab] = useState<InspectTab>('overview');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [railDrawer, setRailDrawer] = useState(false);
  const [dialog, setDialog] = useState<'clear' | 'export' | 'settings' | null>(null);
  const [exportFormat, setExportFormat] = useState<EvidenceExportFormat>('har');
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState('');
  const [retentionError, setRetentionError] = useState('');
  const [railWidth, setRailWidth] = useState(216);
  // Wide enough for the whole evidence ledger. The previous 640 left the
  // table clipping Method, Duration, and Evidence at store width.
  const [listWidth, setListWidth] = useState(800);
  const ledgerScroll = useRef<Readonly<{ left: number; top: number }>>({
    left: 0,
    top: 0,
  });

  const groups = useMemo(
    () => correlate({ interactions: session.interactions, requests: session.requests }),
    [session.interactions, session.requests],
  );
  const activeGroup =
    activeGroupId === null
      ? null
      : (groups.find(({ id }) => id === activeGroupId) ?? null);
  const groupedRequests = useMemo(() => {
    if (activeGroup === null) return session.requests;
    const ids = new Set(activeGroup.requestIds);
    return session.requests.filter(({ id }) => ids.has(id));
  }, [activeGroup, session.requests]);
  const facetOptions = useMemo<FacetFilterOptions>(() => {
    const methods = new Set<string>();
    const domains = new Set<string>();
    const protocols = new Set<string>();
    for (const request of session.requests) {
      methods.add(request.method.trim().toUpperCase());
      protocols.add(request.classification?.kind.trim().toLowerCase() ?? 'unknown');
      try {
        domains.add(new URL(request.url).hostname.toLowerCase());
      } catch {
        // An invalid URL remains visible unless a domain facet is active.
      }
    }
    const sorted = (values: Set<string>) =>
      [...values].filter(Boolean).sort((left, right) => left.localeCompare(right));
    return {
      methods: sorted(methods),
      domains: sorted(domains),
      protocols: sorted(protocols),
    };
  }, [session.requests]);
  const filtered = useMemo(() => {
    const faceted = filterRequests(groupedRequests, {
      apiOnly,
      ...(facetFilters.method === '' ? {} : { methods: [facetFilters.method] }),
      ...(facetFilters.domain === '' ? {} : { domains: [facetFilters.domain] }),
      ...(facetFilters.protocol === '' ? {} : { kinds: [facetFilters.protocol] }),
      ...(facetFilters.outcome === '' ? {} : { outcome: facetFilters.outcome }),
      ...(facetFilters.cache === '' ? {} : { cache: facetFilters.cache }),
    });
    return filterRequests(faceted, {
      apiOnly: false,
      ...(quickFilters.failures ? { outcome: 'failure' as const } : {}),
      ...(quickFilters.slowCalls ? { slowOnly: true } : {}),
      ...(quickFilters.cacheHits ? { cache: 'hit' as const } : {}),
    });
  }, [apiOnly, facetFilters, groupedRequests, quickFilters]);
  const searching = search.trim() !== '';
  const interactionByRequest = useMemo(() => {
    const byEventId = new Map(
      session.interactions.map((interaction) => [interaction.id, interaction] as const),
    );
    const result = new Map<string, (typeof session.interactions)[number]>();
    for (const group of groups) {
      if (group.kind === 'unattributed') continue;
      const interaction = byEventId.get(group.event.id);
      if (interaction === undefined) continue;
      for (const requestId of group.requestIds) {
        result.set(requestId, interaction);
      }
    }
    return result;
  }, [groups, session.interactions]);
  const searchIndex = useMemo(() => new SearchIndex(), []);
  const visibleRequests = useMemo(() => {
    searchIndex.synchronize(filtered, interactionByRequest);
    return searching ? searchIndex.query(search) : filtered;
  }, [filtered, interactionByRequest, search, searchIndex, searching]);
  const selected = session.requests.find(({ id }) => id === selectedId) ?? null;
  const selectedGroup =
    selected === null
      ? null
      : (groups.find(({ requestIds }) => requestIds.includes(selected.id)) ?? null);
  const selectedIndex =
    selected === null ? -1 : session.requests.findIndex(({ id }) => id === selected.id);
  const compareWith = previousRepeatedRequest(
    selected,
    session.requests,
    selectedIndex,
  );
  const relatedRequests =
    selectedGroup === null
      ? []
      : session.requests.filter((request) =>
          selectedGroup.requestIds.includes(request.id),
        );
  const columns = wideColumns(viewportWidth, railWidth, listWidth);
  const warningCodes = useMemo(
    () => new Set(session.warnings.map(({ code }) => code)),
    [session.warnings],
  );
  const empty =
    session.requests.length === 0
      ? emptyKind(session.phase, session.origin, warningCodes)
      : null;
  const storageWarningMessage = storageWarning(warningCodes);

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
      setActiveGroupId(null);
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
      await exportEvidence(exportFormat);
      setDialog(null);
      setAnnouncement(
        exportFormat === 'har'
          ? 'Sanitized HAR exported.'
          : 'Markdown QA report exported.',
      );
    } catch {
      setActionError('Export failed. Keep the session open and try again.');
      setAnnouncement('Export failed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeTheme(nextTheme: ThemeMode): Promise<void> {
    if (nextTheme === theme) return;
    const previousTheme = theme;
    setTheme(nextTheme);
    setActionError('');
    try {
      const saved = await settingsService.saveTheme(nextTheme);
      setTheme(saved.theme);
      setAnnouncement('Theme setting saved.');
    } catch {
      setTheme(previousTheme);
      setActionError('Theme setting could not be saved. The previous theme remains.');
      setAnnouncement('Theme setting was not saved.');
    }
  }

  function openSettings(): void {
    setActionError('');
    setCustomFieldDraft(customFieldNames.join('\n'));
    setDialog('settings');
  }

  async function savePrivacySettings(): Promise<void> {
    if (
      session.phase !== 'stopped' ||
      session.requests.length > 0 ||
      session.interactions.length > 0
    ) {
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const names = parseCustomFieldNames(customFieldDraft);
      const saved = await settingsService.saveCustomFieldNames(names);
      setCustomFieldNames(saved.customFieldNames);
      setDialog(null);
      setAnnouncement('Privacy settings saved.');
    } catch {
      setActionError(
        'Privacy settings could not be saved. Existing redaction remains active.',
      );
      setAnnouncement('Privacy settings were not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRetention(retention: RetentionMode): Promise<void> {
    if (retention === controller.getSnapshot().retention) return;
    setBusy(true);
    setActionError('');
    setRetentionError('');
    try {
      await controller.setRetention(retention);
      const current = controller.getSnapshot().retention;
      if (current !== retention) {
        setRetentionError(
          `Storage mode could not be changed. Existing evidence remains in ${
            current === 'persistent' ? 'Local' : 'Memory'
          }.`,
        );
        setAnnouncement('Evidence retention was not changed.');
        return;
      }
      setAnnouncement(
        retention === 'persistent'
          ? 'Evidence retention changed to Local until Clear.'
          : 'Evidence retention changed to Memory for this browser session.',
      );
    } catch {
      const current = controller.getSnapshot().retention;
      setRetentionError(
        `Storage mode could not be changed. Existing evidence remains in ${
          current === 'persistent' ? 'Local' : 'Memory'
        }.`,
      );
      setAnnouncement('Evidence retention was not changed.');
    } finally {
      setBusy(false);
    }
  }

  /** Abandoning a dialog also abandons the failure it was reporting. */
  function dismissDialog(): void {
    setActionError('');
    setDialog(null);
  }

  function select(request: SanitizedCapturedRequest): void {
    setSelectedId(request.id);
    setMobileDetail(true);
  }

  function changeQuickFilter(filter: QuickFilter, value: boolean): void {
    setQuickFilters((current) => ({ ...current, [filter]: value }));
  }

  function changeFacetFilter(filter: FacetFilter, value: string): void {
    setFacetFilters((current) => ({ ...current, [filter]: value }));
  }

  function resetFilters(): void {
    setApiOnly(false);
    setQuickFilters(NO_QUICK_FILTERS);
    setFacetFilters(NO_FACET_FILTERS);
    setSearch('');
    setActiveGroupId(null);
  }

  function changeGroup(groupId: string | null): void {
    setActiveGroupId(groupId);
    setRailDrawer(false);
    if (groupId === null) return;
    const group = groups.find(({ id }) => id === groupId);
    const firstId = group?.requestIds[0];
    setSelectedId(firstId ?? null);
    if (firstId === undefined) setMobileDetail(false);
  }

  const narrowLayout = mode === 'narrow' || mode === 'phone';
  const privacySettingsLocked =
    session.phase !== 'stopped' ||
    session.requests.length > 0 ||
    session.interactions.length > 0;
  // The wide layout renders the rail inline, so a drawer left open would
  // duplicate the navigation and strand focus on its unmounted trigger.
  useEffect(() => {
    if (mode === 'wide') setRailDrawer(false);
  }, [mode]);
  useEffect(() => {
    if (activeGroupId !== null && !groups.some(({ id }) => id === activeGroupId)) {
      setActiveGroupId(null);
    }
  }, [activeGroupId, groups]);
  const detailRef = useRef<HTMLElement | null>(null);
  const ledgerRef = useRef<HTMLDivElement | null>(null);
  // The narrow layout swaps two mutually exclusive subtrees, so whichever
  // element had focus is destroyed on every switch. Focus moves into the region
  // that replaced it instead of falling back to the document body.
  useEffect(() => {
    if (!narrowLayout) return;
    if (mobileDetail && selectedId !== null) {
      detailRef.current?.focus();
      return;
    }
    ledgerRef.current
      ?.querySelector<HTMLElement>(
        'tbody tr[aria-selected="true"], tbody tr[tabindex="0"]',
      )
      ?.focus();
  }, [mobileDetail, narrowLayout, selectedId]);

  const rail = (
    <SessionRail
      apiOnly={apiOnly}
      facetFilters={facetFilters}
      facetOptions={facetOptions}
      groups={groups}
      onApiOnlyChange={setApiOnly}
      onFacetFilterChange={changeFacetFilter}
      onGroupChange={changeGroup}
      onQuickFilterChange={changeQuickFilter}
      onResetFilters={resetFilters}
      onRetentionChange={(retention) => void changeRetention(retention)}
      quickFilters={quickFilters}
      retentionBusy={busy}
      retentionError={retentionError}
      selectedGroupId={activeGroupId}
      session={session}
    />
  );

  const ledger = (
    <Ledger
      compact={ledgerIsCompact(mode, columns.list)}
      empty={empty}
      onOpenRail={() => setRailDrawer(true)}
      onRecord={() => void toggleRecording()}
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
  const ledgerRegion = (
    <div className="ledger-slot" ref={ledgerRef}>
      {ledger}
    </div>
  );
  const detail = (
    <DetailSlot
      activeMode={detailMode}
      {...(compareWith === undefined ? {} : { compareWith })}
      containerRef={detailRef}
      group={selectedGroup}
      hasRequests={visibleRequests.length > 0}
      inspectTab={inspectTab}
      {...(mode === 'narrow' || mode === 'phone'
        ? {
            onBack: () => {
              setMobileDetail(false);
            },
          }
        : {})}
      onInspectTabChange={setInspectTab}
      onModeChange={setDetailMode}
      relatedRequests={relatedRequests}
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
        {ledgerRegion}
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
        {ledgerRegion}
        {detail}
      </div>
    );
  } else {
    workspace = (
      <div className="workspace workspace--narrow">
        {selected !== null && mobileDetail ? detail : ledgerRegion}
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
          onSettings={openSettings}
          onTheme={(nextTheme) => void changeTheme(nextTheme)}
          origin={session.origin}
          phase={session.phase}
          theme={theme}
        />
        <div className="app-notices">
          <div aria-atomic="true" className="sr-only" role="status">
            {announcement || phaseLabel(session.phase)}
          </div>

          {storageWarningMessage === null ? null : (
            <div className="session-notice session-notice--failure" role="alert">
              <Icon name="archive" />
              {storageWarningMessage}
            </div>
          )}
          {session.evictedCount > 0 ? (
            <div className="session-notice" role="note">
              <Icon name="archive" />
              {session.evictedCount} oldest requests were removed to keep this session
              within its storage limit.
            </div>
          ) : null}
          {warningCodes.has('interaction-start-failed') &&
          session.requests.length > 0 ? (
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
        </div>

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
            facetFilters={facetFilters}
            facetOptions={facetOptions}
            groups={groups}
            onApiOnlyChange={setApiOnly}
            onClose={() => setRailDrawer(false)}
            onFacetFilterChange={changeFacetFilter}
            onGroupChange={changeGroup}
            onQuickFilterChange={changeQuickFilter}
            onResetFilters={resetFilters}
            onRetentionChange={(retention) => void changeRetention(retention)}
            quickFilters={quickFilters}
            retentionBusy={busy}
            retentionError={retentionError}
            selectedGroupId={activeGroupId}
            session={session}
          />
        </ModalSurface>
      ) : null}

      {dialog === 'clear' ? (
        <Dialog
          description="This removes the current local evidence session. Recording stops first. This action cannot be undone."
          onClose={dismissDialog}
          title="Clear captured evidence"
        >
          {actionError === '' ? null : (
            <p className="dialog__error" role="alert">
              {actionError}
            </p>
          )}
          <div className="dialog__actions">
            <Button data-initial-focus="" onClick={dismissDialog}>
              Keep evidence
            </Button>
            <Button disabled={busy} onClick={() => void clearEvidence()} tone="danger">
              Clear evidence now
            </Button>
          </div>
        </Dialog>
      ) : null}

      {dialog === 'export' ? (
        <ExportDialog
          busy={busy}
          error={actionError}
          format={exportFormat}
          onClose={dismissDialog}
          onExport={() => void exportSafeEvidence()}
          onFormatChange={setExportFormat}
          requestCount={session.requests.length}
        />
      ) : null}

      {dialog === 'settings' ? (
        <Dialog
          description="Add field names that Payloadra must always redact. Mandatory authorization, cookie, credential-name, and token-pattern protection stays on."
          onClose={dismissDialog}
          title="Privacy and redaction settings"
        >
          <label className="settings-field">
            <span>Additional sensitive field names</span>
            <textarea
              aria-label="Additional sensitive field names"
              data-initial-focus=""
              disabled={busy || privacySettingsLocked}
              onChange={(event) => setCustomFieldDraft(event.target.value)}
              placeholder={'Private Note\nX-Customer-Key'}
              rows={5}
              value={customFieldDraft}
            />
            <small>One name per line or comma. Matching is case-insensitive.</small>
          </label>
          {privacySettingsLocked ? (
            <p className="settings-lock" role="note">
              Stop recording and Clear the current evidence before changing these
              fields. This keeps older evidence from carrying a different redaction
              policy.
            </p>
          ) : null}
          {actionError === '' ? null : (
            <p className="dialog__error" role="alert">
              {actionError}
            </p>
          )}
          <div className="dialog__actions">
            <Button onClick={dismissDialog}>Cancel</Button>
            <Button
              disabled={busy || privacySettingsLocked}
              onClick={() => void savePrivacySettings()}
              tone="primary"
            >
              Save privacy settings
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
  settings = DEFAULT_SETTINGS_SERVICE,
}: Readonly<{
  controller: SessionController;
  devtoolsTheme?: DevtoolsThemeSource;
  exportEvidence?: (format: EvidenceExportFormat) => Promise<void>;
  settings?: PayloadraSettingsService;
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
        <PanelShell devtoolsThemeSource={devtoolsTheme} settingsService={settings} />
      </AppProvider>
    </AppErrorBoundary>
  );
}
