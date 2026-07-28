import { describe, expect, it } from 'vitest';

import type {
  RuntimePortLike,
  RuntimeSenderLike,
} from '../../../src/infrastructure/chrome/interaction-bridge';
import {
  createPanelFocusCoordinator,
  PANEL_FOCUS_PORT_PREFIX,
  PANEL_FOCUS_REQUEST_MESSAGE,
  PANEL_FOCUS_SHOW,
  PANEL_FOCUS_STATUS_MESSAGE,
} from '../../../src/infrastructure/chrome/panel-focus';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function panelSender(overrides: Partial<RuntimeSenderLike> = {}): RuntimeSenderLike {
  return {
    id: EXTENSION_ID,
    origin: `chrome-extension://${EXTENSION_ID}`,
    url: `chrome-extension://${EXTENSION_ID}/devtools.html`,
    ...overrides,
  };
}

class FakePort implements RuntimePortLike {
  readonly posted: unknown[] = [];
  disconnected = false;
  postError: Error | null = null;
  private disconnectListeners: (() => void)[] = [];

  constructor(
    readonly name: string,
    readonly sender: RuntimeSenderLike | undefined = panelSender(),
  ) {}

  readonly onMessage = {
    addListener: () => undefined,
    removeListener: () => undefined,
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
    removeListener: () => undefined,
  };

  postMessage(message: unknown): void {
    if (this.postError !== null) throw this.postError;
    this.posted.push(message);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emitDisconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

function coordinator() {
  return createPanelFocusCoordinator({ extensionId: EXTENSION_ID });
}

describe('panel focus port registration', () => {
  it('leaves a port it does not own for another coordinator to claim', () => {
    const port = new FakePort('payloadra:content');

    expect(coordinator().acceptPort(port)).toBe(false);
    expect(port.disconnected).toBe(false);
  });

  it('registers a DevTools page and reports the panel as reachable', () => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);

    expect(focus.acceptPort(port)).toBe(true);
    expect(focus.available(7)).toBe(true);
    expect(focus.focus(7)).toBe(true);
    expect(port.posted).toEqual([{ type: PANEL_FOCUS_SHOW }]);
  });

  it.each([
    ['a content script', () => panelSender({ tab: { id: 4 } })],
    [
      'another extension',
      () => panelSender({ id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }),
    ],
    ['a mismatched origin', () => panelSender({ origin: 'https://app.test' })],
    ['a web page url', () => panelSender({ url: 'https://app.test/devtools.html' })],
    ['a page with no url', () => panelSender({ url: undefined })],
    ['a missing sender', () => undefined],
  ])('claims but disconnects a port from %s', (_label, makeSender) => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    Object.defineProperty(port, 'sender', { value: makeSender() });

    expect(focus.acceptPort(port)).toBe(true);
    expect(port.disconnected).toBe(true);
    expect(focus.available(7)).toBe(false);
  });

  it.each(['', 'x', '-1', '007', '1.5', String(Number.MAX_SAFE_INTEGER) + '0'])(
    'rejects the malformed tab identifier %s',
    (tabText) => {
      const focus = coordinator();
      const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}${tabText}`);

      expect(focus.acceptPort(port)).toBe(true);
      expect(port.disconnected).toBe(true);
    },
  );

  it('supersedes a stale registration when DevTools reopens on the same tab', () => {
    const focus = coordinator();
    const stale = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    const fresh = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);

    focus.acceptPort(stale);
    focus.acceptPort(fresh);

    expect(stale.disconnected).toBe(true);
    expect(focus.focus(7)).toBe(true);
    expect(stale.posted).toEqual([]);
    expect(fresh.posted).toHaveLength(1);
  });

  it('forgets a tab once its DevTools window closes', () => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    focus.acceptPort(port);

    port.emitDisconnect();

    expect(focus.available(7)).toBe(false);
    expect(focus.focus(7)).toBe(false);
  });

  it('forgets a tab whose port rejects the show message', () => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    port.postError = new Error('port closed');
    focus.acceptPort(port);

    expect(focus.focus(7)).toBe(false);
    expect(focus.available(7)).toBe(false);
  });

  it('does not leave a stale entry when the disconnect listener cannot be added', () => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    Object.defineProperty(port, 'onDisconnect', {
      value: {
        addListener: () => {
          throw new Error('detached');
        },
      },
    });

    expect(focus.acceptPort(port)).toBe(true);
    expect(focus.available(7)).toBe(false);
  });
});

describe('panel focus messages', () => {
  it('ignores a message that is not part of this channel', () => {
    expect(
      coordinator().handleMessage(
        { type: 'payloadra:start-interactions' },
        panelSender(),
      ),
    ).toBeNull();
  });

  it('stays silent for a sender that is not one of our own pages', () => {
    const focus = coordinator();
    focus.acceptPort(new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`));

    expect(
      focus.handleMessage(
        { type: PANEL_FOCUS_STATUS_MESSAGE, tabId: 7 },
        panelSender({ tab: { id: 7 } }),
      ),
    ).toBeNull();
  });

  it('reports availability per tab', () => {
    const focus = coordinator();
    focus.acceptPort(new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`));

    expect(
      focus.handleMessage(
        { type: PANEL_FOCUS_STATUS_MESSAGE, tabId: 7 },
        panelSender(),
      ),
    ).toEqual({ available: true });
    expect(
      focus.handleMessage(
        { type: PANEL_FOCUS_STATUS_MESSAGE, tabId: 8 },
        panelSender(),
      ),
    ).toEqual({ available: false });
  });

  it('focuses a registered panel and reports a closed window otherwise', () => {
    const focus = coordinator();
    const port = new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`);
    focus.acceptPort(port);

    expect(
      focus.handleMessage(
        { type: PANEL_FOCUS_REQUEST_MESSAGE, tabId: 7 },
        panelSender(),
      ),
    ).toEqual({ status: 'focused' });
    expect(
      focus.handleMessage(
        { type: PANEL_FOCUS_REQUEST_MESSAGE, tabId: 8 },
        panelSender(),
      ),
    ).toEqual({ status: 'devtools-closed' });
    expect(port.posted).toEqual([{ type: PANEL_FOCUS_SHOW }]);
  });

  it.each([
    [PANEL_FOCUS_STATUS_MESSAGE, { available: false }],
    [PANEL_FOCUS_REQUEST_MESSAGE, { status: 'devtools-closed' }],
  ])('fails closed for %s carrying an invalid tab identifier', (type, expected) => {
    const focus = coordinator();
    focus.acceptPort(new FakePort(`${PANEL_FOCUS_PORT_PREFIX}7`));

    expect(focus.handleMessage({ type, tabId: -1 }, panelSender())).toEqual(expected);
    expect(focus.handleMessage({ type }, panelSender())).toEqual(expected);
  });

  it('does not run a getter an untrusted message defines for its fields', () => {
    const focus = coordinator();
    let read = 0;
    const message = { type: PANEL_FOCUS_STATUS_MESSAGE };
    Object.defineProperty(message, 'tabId', {
      enumerable: true,
      get: () => {
        read += 1;
        return 7;
      },
    });

    expect(focus.handleMessage(message, panelSender())).toEqual({ available: false });
    expect(read).toBe(0);
  });
});
