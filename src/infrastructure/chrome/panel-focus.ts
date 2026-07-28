import type { RuntimePortLike, RuntimeSenderLike } from './interaction-bridge';

/**
 * Chrome offers no API for opening the DevTools window, so the toolbar action
 * cannot summon the panel on its own. What it can do is switch DevTools to the
 * Payloadra tab when the window is already open, through `ExtensionPanel.show`.
 *
 * The DevTools page holds the only reference that can do it, so it registers a
 * port here keyed by the tab it inspects. A registered port therefore means two
 * things at once: DevTools is open on that tab, and this Chrome can switch to
 * the panel. Chrome below 140 has no `show`, so it never registers, and the
 * popup falls back to telling the reader what to click.
 */
export const PANEL_FOCUS_PORT_PREFIX = 'payloadra:panel-focus:';
export const PANEL_FOCUS_SHOW = 'payloadra:show-panel';
export const PANEL_FOCUS_STATUS_MESSAGE = 'payloadra:panel-focus-status';
export const PANEL_FOCUS_REQUEST_MESSAGE = 'payloadra:panel-focus-request';

export type PanelFocusStatus = Readonly<{ available: boolean }>;
export type PanelFocusOutcome = Readonly<{
  status: 'focused' | 'devtools-closed';
}>;

export interface PanelFocusCoordinator {
  /**
   * Returns whether the port belonged to this channel at all, so a caller can
   * offer an unclaimed port to another coordinator. A port that is ours but
   * untrustworthy is disconnected and still reported as claimed.
   */
  acceptPort(port: RuntimePortLike): boolean;
  available(tabId: number): boolean;
  focus(tabId: number): boolean;
  /**
   * Answers a popup query. Returns `null` when the message is not ours or its
   * sender is not one of our own extension pages, so the caller stays silent
   * rather than reporting on the browsing session to an unknown asker.
   */
  handleMessage(
    message: unknown,
    sender: RuntimeSenderLike,
  ): PanelFocusStatus | PanelFocusOutcome | null;
}

export type PanelFocusDependencies = Readonly<{ extensionId: string }>;

function extensionOrigin(extensionId: string): string {
  return `chrome-extension://${extensionId}`;
}

function isExtensionPage(sender: RuntimeSenderLike, extensionId: string): boolean {
  try {
    if (
      sender.id !== extensionId ||
      sender.tab !== undefined ||
      sender.origin !== extensionOrigin(extensionId)
    ) {
      return false;
    }
    const url = new URL(sender.url ?? '');
    return (
      url.protocol === 'chrome-extension:' &&
      url.hostname === extensionId &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function parseTabId(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const tabId = Number(value);
  return Number.isSafeInteger(tabId) ? tabId : null;
}

/** Reads a field without running a getter an untrusted object could define. */
function ownValue(value: unknown, key: string): unknown {
  try {
    const descriptor =
      value !== null && typeof value === 'object'
        ? Object.getOwnPropertyDescriptor(value, key)
        : undefined;
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function messageTabId(message: unknown): number | null {
  const tabId = ownValue(message, 'tabId');
  return typeof tabId === 'number' && Number.isSafeInteger(tabId) && tabId >= 0
    ? tabId
    : null;
}

function safeDisconnect(port: RuntimePortLike): void {
  try {
    port.disconnect();
  } catch {
    // A port that is already gone needs no teardown.
  }
}

export function createPanelFocusCoordinator(
  dependencies: PanelFocusDependencies,
): PanelFocusCoordinator {
  const ports = new Map<number, RuntimePortLike>();

  function focusTab(tabId: number): boolean {
    const port = ports.get(tabId);
    if (port === undefined) {
      return false;
    }
    try {
      port.postMessage({ type: PANEL_FOCUS_SHOW });
      return true;
    } catch {
      ports.delete(tabId);
      return false;
    }
  }

  return {
    acceptPort(port): boolean {
      let name: string;
      try {
        name = port.name;
      } catch {
        return false;
      }
      if (!name.startsWith(PANEL_FOCUS_PORT_PREFIX)) {
        return false;
      }
      const sender = port.sender;
      if (sender === undefined || !isExtensionPage(sender, dependencies.extensionId)) {
        safeDisconnect(port);
        return true;
      }
      const tabId = parseTabId(name.slice(PANEL_FOCUS_PORT_PREFIX.length));
      if (tabId === null) {
        safeDisconnect(port);
        return true;
      }

      // Reopening DevTools on the same tab supersedes the stale registration.
      const previous = ports.get(tabId);
      if (previous !== undefined && previous !== port) {
        safeDisconnect(previous);
      }
      ports.set(tabId, port);
      try {
        port.onDisconnect.addListener(() => {
          if (ports.get(tabId) === port) {
            ports.delete(tabId);
          }
        });
      } catch {
        ports.delete(tabId);
        return true;
      }
      return true;
    },

    available(tabId): boolean {
      return ports.has(tabId);
    },

    focus: focusTab,

    handleMessage(message, sender): PanelFocusStatus | PanelFocusOutcome | null {
      const type = ownValue(message, 'type');
      if (type !== PANEL_FOCUS_STATUS_MESSAGE && type !== PANEL_FOCUS_REQUEST_MESSAGE) {
        return null;
      }
      if (!isExtensionPage(sender, dependencies.extensionId)) {
        return null;
      }
      const tabId = messageTabId(message);
      if (tabId === null) {
        return type === PANEL_FOCUS_STATUS_MESSAGE
          ? { available: false }
          : { status: 'devtools-closed' };
      }
      return type === PANEL_FOCUS_STATUS_MESSAGE
        ? { available: ports.has(tabId) }
        : { status: focusTab(tabId) ? 'focused' : 'devtools-closed' };
    },
  };
}
