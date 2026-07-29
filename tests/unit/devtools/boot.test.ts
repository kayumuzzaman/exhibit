import { describe, expect, it, vi } from 'vitest';

import {
  bootDevtools,
  type DevtoolsPanels,
  type FocusPort,
} from '../../../src/devtools/boot';
import {
  PANEL_FOCUS_PORT_PREFIX,
  PANEL_FOCUS_SHOW,
} from '../../../src/infrastructure/chrome/panel-focus';

type Created = [string, string, string, (panel: unknown) => void];

function recordingPanels(): { panels: DevtoolsPanels; calls: Created[] } {
  const calls: Created[] = [];
  return {
    calls,
    panels: {
      create: (title, icon, page, callback) => {
        calls.push([title, icon, page, callback]);
      },
    },
  };
}

class FakeFocusPort implements FocusPort {
  readonly messageListeners: ((message: unknown) => void)[] = [];
  readonly disconnectListeners: (() => void)[] = [];
  disconnected = false;

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
  };

  disconnect(): void {
    this.disconnected = true;
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitDisconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

describe('bootDevtools', () => {
  it('creates the Exhibit DevTools panel with bundled assets', () => {
    const { panels, calls } = recordingPanels();

    bootDevtools({ panels });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual(['Exhibit', 'icon/16.png', 'panel.html']);
    expect(() => calls[0]?.[3]({})).not.toThrow();
  });

  it('registers a focus port keyed by the inspected tab and shows the panel on request', () => {
    const { panels, calls } = recordingPanels();
    const port = new FakeFocusPort();
    const connect = vi.fn(() => port);
    const show = vi.fn();

    bootDevtools({ panels, connect, tabId: 12, schedule: () => undefined });
    calls[0]?.[3]({ show });

    expect(connect).toHaveBeenCalledWith({ name: `${PANEL_FOCUS_PORT_PREFIX}12` });
    port.emit({ type: PANEL_FOCUS_SHOW });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('ignores traffic on the focus port that is not a show request', () => {
    const { panels, calls } = recordingPanels();
    const port = new FakeFocusPort();
    const show = vi.fn();

    bootDevtools({ panels, connect: () => port, tabId: 1, schedule: () => undefined });
    calls[0]?.[3]({ show });
    port.emit({ type: 'exhibit:start-interactions' });
    port.emit(null);
    port.emit('show');

    expect(show).not.toHaveBeenCalled();
  });

  it('keeps DevTools usable when the panel refuses to activate', () => {
    const { panels, calls } = recordingPanels();
    const port = new FakeFocusPort();

    bootDevtools({ panels, connect: () => port, tabId: 1, schedule: () => undefined });
    calls[0]?.[3]({
      show: () => {
        throw new Error('panel detached');
      },
    });

    expect(() => port.emit({ type: PANEL_FOCUS_SHOW })).not.toThrow();
  });

  it('does not connect on a Chrome that cannot activate the panel', () => {
    const { panels, calls } = recordingPanels();
    const connect = vi.fn(() => new FakeFocusPort());

    bootDevtools({ panels, connect, tabId: 3, schedule: () => undefined });
    calls[0]?.[3]({});
    calls[0]?.[3](null);

    expect(connect).not.toHaveBeenCalled();
  });

  it('reconnects after the service worker drops the port', () => {
    const { panels, calls } = recordingPanels();
    const ports = [new FakeFocusPort(), new FakeFocusPort()];
    let opened = 0;
    const connect = vi.fn(() => ports[opened++] ?? new FakeFocusPort());
    const scheduled: (() => void)[] = [];
    const show = vi.fn();

    bootDevtools({
      panels,
      connect,
      tabId: 5,
      schedule: (task) => {
        scheduled.push(task);
      },
    });
    calls[0]?.[3]({ show });
    ports[0]?.emitDisconnect();
    scheduled.pop()?.();
    ports[1]?.emit({ type: PANEL_FOCUS_SHOW });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly when the runtime refuses the connection', () => {
    const { panels, calls } = recordingPanels();
    const connect = vi.fn(() => {
      throw new Error('extension context invalidated');
    });

    bootDevtools({ panels, connect, tabId: 5, schedule: () => undefined });

    expect(() => calls[0]?.[3]({ show: () => undefined })).not.toThrow();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 1.5, Number.NaN])('rejects the unusable tab identifier %s', (tabId) => {
    const { panels, calls } = recordingPanels();
    const connect = vi.fn(() => new FakeFocusPort());

    bootDevtools({ panels, connect, tabId, schedule: () => undefined });
    calls[0]?.[3]({ show: () => undefined });

    expect(connect).not.toHaveBeenCalled();
  });
});
