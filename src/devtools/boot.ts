import {
  PANEL_FOCUS_PORT_PREFIX,
  PANEL_FOCUS_SHOW,
} from '../infrastructure/chrome/panel-focus';

export interface DevtoolsPanel {
  /** Added in Chrome 140. Older builds expose no way to activate the tab. */
  show?: () => void;
}

export interface DevtoolsPanels {
  create(
    title: string,
    icon: string,
    page: string,
    callback: (panel: unknown) => void,
  ): void;
}

export interface FocusPort {
  readonly onMessage: { addListener(listener: (message: unknown) => void): void };
  readonly onDisconnect: { addListener(listener: () => void): void };
  disconnect(): void;
}

export type FocusConnect = (options: Readonly<{ name: string }>) => FocusPort;

export type BootDevtoolsDependencies = Readonly<{
  panels?: DevtoolsPanels;
  connect?: FocusConnect;
  tabId?: number;
  schedule?: (task: () => void, delayMs: number) => void;
}>;

/** The service worker can be evicted mid-session, taking the port with it. */
const RECONNECT_DELAY_MS = 1_000;

function messageType(message: unknown): unknown {
  try {
    const descriptor =
      message !== null && typeof message === 'object'
        ? Object.getOwnPropertyDescriptor(message, 'type')
        : undefined;
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function registerFocusChannel(
  show: () => void,
  connect: FocusConnect,
  tabId: number,
  schedule: (task: () => void, delayMs: number) => void,
): void {
  let closed = false;

  function open(): void {
    if (closed) return;
    let port: FocusPort;
    try {
      port = connect({ name: `${PANEL_FOCUS_PORT_PREFIX}${tabId}` });
    } catch {
      // Focus is a convenience. A refused connection must never break DevTools.
      return;
    }
    try {
      port.onMessage.addListener((message) => {
        if (messageType(message) !== PANEL_FOCUS_SHOW) return;
        try {
          show();
        } catch {
          // A panel that refuses to activate leaves the reader where they were.
        }
      });
      port.onDisconnect.addListener(() => {
        // The DevTools page dies with its window, so this cannot outlive it.
        schedule(open, RECONNECT_DELAY_MS);
      });
    } catch {
      closed = true;
    }
  }

  open();
}

export function bootDevtools(dependencies: BootDevtoolsDependencies = {}): void {
  const panels = dependencies.panels ?? chrome.devtools.panels;
  panels.create('Exhibit', 'icon/16.png', 'panel.html', (created) => {
    const panel = created as DevtoolsPanel | null | undefined;
    const show = panel?.show;
    if (typeof show !== 'function') return;

    let tabId: number;
    let connect: FocusConnect;
    try {
      tabId = dependencies.tabId ?? chrome.devtools.inspectedWindow.tabId;
      connect =
        dependencies.connect ??
        ((options) => chrome.runtime.connect(options) as unknown as FocusPort);
    } catch {
      return;
    }
    if (!Number.isSafeInteger(tabId) || tabId < 0) return;

    registerFocusChannel(
      () => show.call(panel),
      connect,
      tabId,
      dependencies.schedule ?? ((task, delayMs) => setTimeout(task, delayMs)),
    );
  });
}
