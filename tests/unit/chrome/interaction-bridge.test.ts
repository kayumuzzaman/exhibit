import { describe, expect, it, vi } from 'vitest';

import {
  createBackgroundInteractionCoordinator,
  createInteractionSource,
  installInteractionCollector,
  installMainHistoryHook,
  teardownMainHistoryHook,
  type BackgroundInteractionDependencies,
  type CollectorDomEvent,
  type CollectorEnvironment,
  type RuntimePortLike,
  type RuntimeSenderLike,
  type ScriptInjectionLike,
} from '../../../src/infrastructure/chrome/interaction-bridge';
import {
  deriveOriginPermission,
  sanitizePageUrl,
} from '../../../src/infrastructure/chrome/permissions';
import {
  describeElement,
  describeSubmit,
  type ElementLike,
} from '../../../src/domain/element-label';

type Listener = (message: unknown) => void;

class FakePort implements RuntimePortLike {
  readonly sent: unknown[] = [];
  readonly messageListeners = new Set<Listener>();
  readonly disconnectListeners = new Set<() => void>();
  disconnected = false;

  readonly onMessage = {
    addListener: (listener: Listener) => this.messageListeners.add(listener),
    removeListener: (listener: Listener) => this.messageListeners.delete(listener),
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => this.disconnectListeners.add(listener),
    removeListener: (listener: () => void) => this.disconnectListeners.delete(listener),
  };

  constructor(
    readonly name: string,
    readonly sender?: RuntimeSenderLike,
  ) {}

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  disconnect(): void {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

function extensionSender(extensionId = 'extension-id'): RuntimeSenderLike {
  return {
    id: extensionId,
    url: `chrome-extension://${extensionId}/panel.html`,
    origin: `chrome-extension://${extensionId}`,
  };
}

function contentSender(overrides: Partial<RuntimeSenderLike> = {}): RuntimeSenderLike {
  return {
    id: 'extension-id',
    tab: { id: 9, url: 'https://shop.test/cart' },
    frameId: 0,
    documentId: 'document-9',
    url: 'https://shop.test/cart',
    origin: 'https://shop.test',
    ...overrides,
  };
}

function backgroundFixture(overrides: Partial<BackgroundInteractionDependencies> = {}) {
  let mainHookSequence = 0;
  const permissions = {
    request: vi.fn(async () => true),
  };
  const tabs = {
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      url: tabId === 10 ? 'https://other.test/page' : 'https://shop.test/cart',
    })),
  };
  const scripting = {
    executeScript: vi.fn(async (injection: ScriptInjectionLike) => {
      const main = injection.files?.[0] === '/interaction-main.js';
      if (main) {
        mainHookSequence += 1;
      }
      return [
        {
          frameId: 0,
          documentId: `document-${injection.target.tabId}`,
          ...(main ? { result: `hook-${mainHookSequence}` } : {}),
        },
      ];
    }),
  };
  const dependencies: BackgroundInteractionDependencies = {
    extensionId: 'extension-id',
    permissions,
    tabs,
    scripting,
    ...overrides,
  };
  return {
    coordinator: createBackgroundInteractionCoordinator(dependencies),
    permissions: dependencies.permissions,
    tabs: dependencies.tabs,
    scripting: dependencies.scripting,
  };
}

async function startBackground(
  fixture: ReturnType<typeof backgroundFixture>,
  tabId = 9,
  url = 'https://shop.test/cart?token=secret#checkout',
) {
  return fixture.coordinator.handleStart(
    { type: 'payloadra:start-interactions', tabId, url },
    extensionSender(),
  );
}

type ActiveBackgroundStart = Extract<
  Awaited<ReturnType<typeof startBackground>>,
  { status: 'active' }
>;

async function startActiveBackground(
  fixture: ReturnType<typeof backgroundFixture>,
  tabId = 9,
  url = 'https://shop.test/cart?token=secret#checkout',
): Promise<ActiveBackgroundStart> {
  const result = await startBackground(fixture, tabId, url);
  if (result.status !== 'active') {
    throw new Error(`Expected an active interaction lease, got ${result.reason}.`);
  }
  return result;
}

function devtoolsPortName(start: ActiveBackgroundStart): string {
  return `payloadra:devtools:${start.tabId}:${start.leaseId}`;
}

function fakeElement(
  localName: string,
  attributes: Readonly<Record<string, string | null>> = {},
  textContent: string | null = null,
  reads: string[] = [],
): ElementLike {
  return {
    localName,
    getAttribute(name: string) {
      reads.push(name);
      return attributes[name] ?? null;
    },
    readText(maxCodeUnits: number) {
      return textContent === null || textContent.length > maxCodeUnits
        ? null
        : textContent;
    },
  };
}

class FakeEventHub {
  readonly listeners = new Map<string, Set<(event: CollectorDomEvent) => void>>();
  readonly dispatched: unknown[] = [];

  addEventListener(type: string, listener: (event: CollectorDomEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: (event: CollectorDomEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: unknown): boolean {
    this.dispatched.push(event);
    return true;
  }

  emit(type: string, event: CollectorDomEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function collectorFixture() {
  const document = new FakeEventHub();
  const window = new FakeEventHub();
  const port = new FakePort('payloadra:content');
  const global: Record<string, unknown> = {};
  let href = 'https://shop.test/cart?token=secret#part';
  let sequence = 0;
  const environment: CollectorEnvironment = {
    global,
    document,
    window,
    connect: () => port,
    currentUrl: () => href,
    now: () => 1_000 + sequence,
    nextId: () => `interaction-${++sequence}`,
    createSignal: (type, detail) => ({
      type,
      ...(detail === undefined ? {} : { detail }),
    }),
  };
  return {
    environment,
    document,
    window,
    port,
    global,
    setHref: (value: string) => {
      href = value;
    },
  };
}

function linkedContentPorts(): {
  isolated: FakePort;
  background: FakePort;
} {
  const isolated = new FakePort('payloadra:content');
  const background = new FakePort('payloadra:content', contentSender());
  const isolatedPost = isolated.postMessage.bind(isolated);
  const backgroundPost = background.postMessage.bind(background);
  isolated.postMessage = (message: unknown): void => {
    isolatedPost(message);
    background.emit(message);
  };
  background.postMessage = (message: unknown): void => {
    backgroundPost(message);
    isolated.emit(message);
  };
  return { isolated, background };
}

function pendingValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('origin permissions', () => {
  it.each([
    ['https://shop.test/cart?token=x#part', 'https://shop.test/*'],
    ['http://localhost:3000/path', 'http://localhost:3000/*'],
    ['https://user:pass@shop.test/private', 'https://shop.test/*'],
  ])('derives one exact HTTP(S) origin from %s', (url, pattern) => {
    expect(deriveOriginPermission(url)).toEqual({
      ok: true,
      origin: pattern.slice(0, -2),
      pattern,
    });
  });

  it.each([
    'chrome://settings',
    'chrome-extension://other/page.html',
    'file:///tmp/private',
    'about:blank',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'not a url',
  ])('rejects restricted or malformed page %s', (url) => {
    expect(deriveOriginPermission(url)).toEqual({
      ok: false,
      reason: 'restricted-page',
    });
  });

  it('keeps only origin and pathname in captured page URLs', () => {
    expect(sanitizePageUrl('https://shop.test/cart/item?token=x#secret')).toBe(
      'https://shop.test/cart/item',
    );
    expect(sanitizePageUrl('chrome://settings')).toBeUndefined();
    expect(sanitizePageUrl('bad')).toBeUndefined();
  });

  it('rejects raw URLs above the bounded parser budget', () => {
    const huge = `https://shop.test/${'x'.repeat(20_000)}`;

    expect(deriveOriginPermission(huge)).toEqual({
      ok: false,
      reason: 'restricted-page',
    });
    expect(sanitizePageUrl(huge)).toBeUndefined();
  });
});

describe('privacy-safe element descriptors', () => {
  it('reads no field values or other forbidden attributes for submit targets', () => {
    const reads: string[] = [];
    const form = fakeElement(
      'FORM',
      {
        id: 'checkout',
        name: 'payment',
        action: 'https://shop.test/pay?token=secret',
        value: 'qa@test',
        placeholder: 'Password',
      },
      'qa@test secret Save',
      reads,
    );

    const descriptor = describeSubmit(form);

    expect(descriptor).toEqual({
      tag: 'form',
      name: 'payment',
      id: 'checkout',
    });
    expect(reads).not.toEqual(
      expect.arrayContaining([
        'value',
        'action',
        'href',
        'placeholder',
        'class',
        'dataset',
        'aria-labelledby',
      ]),
    );
    expect(JSON.stringify(descriptor)).not.toMatch(/qa@test|secret/u);
  });

  it('never reads text from inputs, passwords, textareas, selects, or editable nodes', () => {
    const formControls = [
      fakeElement('input', { type: 'password' }, 'password-secret'),
      fakeElement('textarea', {}, 'textarea-secret'),
      fakeElement('select', {}, 'select-secret'),
      fakeElement('div', { contenteditable: 'true' }, 'editable-secret'),
    ];

    expect(formControls.map(describeElement)).toEqual([
      { tag: 'input' },
      { tag: 'textarea' },
      { tag: 'select' },
      { tag: 'div' },
    ]);
  });

  it('normalizes and caps safe actionable text at 80 Unicode code points', () => {
    const label = `${'🧪'.repeat(79)}  final  ignored`;
    const descriptor = describeElement(fakeElement('button', {}, label));

    expect(Array.from(descriptor.text ?? '')).toHaveLength(80);
    expect(descriptor.text).toBe(`${'🧪'.repeat(79)} `);
  });

  it('omits secrets and unsafe identifiers instead of exposing redaction markers', () => {
    const descriptor = describeElement(
      fakeElement(
        'button',
        {
          id: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
          name: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
          role: 'button',
        },
        'Deploy sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      ),
    );

    expect(descriptor).toEqual({ tag: 'button', role: 'button' });
    expect(JSON.stringify(descriptor)).not.toMatch(/sk-proj|eyJ/u);
  });

  it('fails closed for malformed element seams', () => {
    expect(describeElement({ localName: '', getAttribute: () => null })).toEqual({
      tag: 'unknown',
    });
    expect(
      describeElement({
        localName: 'button',
        getAttribute: () => {
          throw new Error('hostile');
        },
      }),
    ).toEqual({ tag: 'button' });
  });

  it('handles role actions, explicitly non-editable text, and hostile DOM getters', () => {
    expect(
      describeElement(
        fakeElement('div', { role: 'button', contenteditable: 'false' }, '  Run  '),
      ),
    ).toEqual({ tag: 'div', role: 'button', text: 'Run' });
    expect(describeElement(fakeElement('bad tag', { id: '   ' }, 'ignored'))).toEqual({
      tag: 'unknown',
    });
    expect(
      describeElement({
        get localName() {
          throw new Error('hostile tag');
        },
        getAttribute: () => null,
      } as unknown as ElementLike),
    ).toEqual({ tag: 'unknown' });
    expect(
      describeElement({
        localName: 'button',
        readText() {
          throw new Error('hostile text');
        },
        getAttribute: () => null,
      } as unknown as ElementLike),
    ).toEqual({ tag: 'button' });
    expect(
      describeElement({
        localName: null,
        getAttribute: () => null,
      } as unknown as ElementLike),
    ).toEqual({ tag: 'unknown' });
  });

  it('bounds page text before normalization and handles the exact Unicode cap', () => {
    expect(describeElement(fakeElement('button', {}, '🧪'.repeat(80)))).toEqual({
      tag: 'button',
      text: '🧪'.repeat(80),
    });
    expect(describeElement(fakeElement('button', {}, '🧪'.repeat(81)))).toEqual({
      tag: 'button',
      text: '🧪'.repeat(80),
    });
    expect(describeElement(fakeElement('button', {}, 'x'.repeat(20_000)))).toEqual({
      tag: 'button',
    });
  });

  it('accepts exactly 32 ASCII tag code points and rejects 33 or multibyte tags', () => {
    expect(describeElement(fakeElement(`a${'b'.repeat(31)}`))).toEqual({
      tag: `a${'b'.repeat(31)}`,
    });
    expect(describeElement(fakeElement(`a${'b'.repeat(32)}`))).toEqual({
      tag: 'unknown',
    });
    expect(describeElement(fakeElement(`a${'🧪'.repeat(31)}`))).toEqual({
      tag: 'unknown',
    });
    expect(describeElement(fakeElement(`a${'🧪'.repeat(32)}`))).toEqual({
      tag: 'unknown',
    });
  });
});

describe('background permission and injection flow', () => {
  it('requests the exact origin immediately and returns typed denial', async () => {
    let resolvePermission!: (granted: boolean) => void;
    const permissionGate = new Promise<boolean>((resolve) => {
      resolvePermission = resolve;
    });
    const fixture = backgroundFixture({
      permissions: { request: vi.fn(() => permissionGate) },
    });

    const starting = startBackground(fixture);

    expect(fixture.permissions.request).toHaveBeenCalledWith({
      origins: ['https://shop.test/*'],
    });
    expect(fixture.tabs.get).not.toHaveBeenCalled();
    resolvePermission(false);
    await expect(starting).resolves.toEqual({
      status: 'network-only',
      reason: 'permission-denied',
    });
    expect(fixture.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('turns permission rejection into a non-fatal network-only result', async () => {
    const fixture = backgroundFixture({
      permissions: {
        request: vi.fn(async () => {
          throw new Error('prompt unavailable');
        }),
      },
    });

    await expect(startBackground(fixture)).resolves.toEqual({
      status: 'network-only',
      reason: 'permission-error',
    });
  });

  it('handles synchronous permission and tab lookup failures without injection', async () => {
    const permissionFailure = backgroundFixture({
      permissions: {
        request: vi.fn(() => {
          throw new Error('synchronous prompt failure');
        }),
      },
    });
    await expect(startBackground(permissionFailure)).resolves.toEqual({
      status: 'network-only',
      reason: 'permission-error',
    });

    const tabFailure = backgroundFixture({
      tabs: {
        get: vi.fn(async () => {
          throw new Error('tab closed');
        }),
      },
    });
    await expect(startBackground(tabFailure)).resolves.toEqual({
      status: 'network-only',
      reason: 'navigation-race',
    });
    expect(tabFailure.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('rejects restricted pages and invalid extension senders before permission', async () => {
    const fixture = backgroundFixture();

    await expect(
      fixture.coordinator.handleStart(
        { type: 'payloadra:start-interactions', tabId: 9, url: 'chrome://settings' },
        extensionSender(),
      ),
    ).resolves.toEqual({
      status: 'network-only',
      reason: 'restricted-page',
    });
    await expect(
      fixture.coordinator.handleStart(
        {
          type: 'payloadra:start-interactions',
          tabId: 9,
          url: 'https://shop.test',
        },
        extensionSender('attacker'),
      ),
    ).resolves.toEqual({
      status: 'network-only',
      reason: 'invalid-sender',
    });
    await expect(
      fixture.coordinator.handleStart(
        {
          type: 'payloadra:start-interactions',
          tabId: 9,
          url: 'https://shop.test',
          origin: 'https://evil.test',
        },
        extensionSender(),
      ),
    ).resolves.toEqual({
      status: 'network-only',
      reason: 'invalid-request',
    });
    expect(fixture.permissions.request).not.toHaveBeenCalled();
  });

  it('closes the navigation race before injection', async () => {
    const fixture = backgroundFixture({
      tabs: {
        get: vi.fn(async () => ({ id: 9, url: 'https://evil.test/phish' })),
      },
    });

    await expect(startBackground(fixture)).resolves.toEqual({
      status: 'network-only',
      reason: 'navigation-race',
    });
    expect(fixture.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('injects the tiny MAIN hook and ISOLATED collector into the main frame only', async () => {
    const fixture = backgroundFixture();

    await expect(startBackground(fixture)).resolves.toEqual({
      status: 'active',
      tabId: 9,
      origin: 'https://shop.test',
      documentId: 'document-9',
      leaseId: expect.any(String),
    });

    expect(fixture.scripting.executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 9, frameIds: [0] },
      files: ['/interaction.js'],
      world: 'ISOLATED',
      injectImmediately: true,
    });
    expect(fixture.scripting.executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 9, frameIds: [0] },
      files: ['/interaction-main.js'],
      world: 'MAIN',
      injectImmediately: true,
    });
  });

  it.each([
    {
      name: 'script rejection',
      execute: async () => {
        throw new Error('cannot inject');
      },
    },
    {
      name: 'frame mismatch',
      execute: async () => [{ frameId: 1, documentId: 'child' }],
    },
    {
      name: 'document race',
      execute: async (injection: { world: 'ISOLATED' | 'MAIN' }) => [
        {
          frameId: 0,
          documentId: injection.world === 'MAIN' ? 'before' : 'after',
        },
      ],
    },
  ])('handles $name as network-only injection failure', async ({ execute }) => {
    const fixture = backgroundFixture({
      scripting: { executeScript: vi.fn(execute) },
    });

    await expect(startBackground(fixture)).resolves.toEqual({
      status: 'network-only',
      reason: 'injection-failed',
    });
  });

  it('keeps independent sessions for multiple inspected tabs', async () => {
    const fixture = backgroundFixture({
      tabs: {
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          url: tabId === 9 ? 'https://shop.test/cart' : 'https://other.test/dashboard',
        })),
      },
    });

    const first = startBackground(fixture, 9, 'https://shop.test/cart');
    const second = startBackground(fixture, 10, 'https://other.test/dashboard');

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'active', tabId: 9 }),
      expect.objectContaining({ status: 'active', tabId: 10 }),
    ]);
    expect(fixture.permissions.request).toHaveBeenCalledWith({
      origins: ['https://shop.test/*'],
    });
    expect(fixture.permissions.request).toHaveBeenCalledWith({
      origins: ['https://other.test/*'],
    });
  });

  it('preserves the bound collector across duplicate Start on the same document', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(content);

    const duplicateStart = await startBackground(fixture);
    expect(duplicateStart).toEqual(
      expect.objectContaining({
        status: 'active',
        documentId: 'document-9',
      }),
    );
    const duplicate = new FakePort('payloadra:content', contentSender());

    expect(fixture.coordinator.acceptPort(duplicate)).toBe(false);
    if (duplicateStart.status === 'active') {
      await fixture.coordinator.handleRelease(
        {
          type: 'payloadra:release-interactions',
          tabId: duplicateStart.tabId,
          leaseId: duplicateStart.leaseId,
        },
        extensionSender(),
      );
    }
    devtools.emit({ type: 'payloadra:stop' });
    expect(content.sent).toEqual([
      {
        type: 'payloadra:collector-config',
        mainHookToken: expect.any(String),
      },
      { type: 'payloadra:collector-stop' },
    ]);
  });

  it('acknowledges exact heartbeats on an active DevTools lease', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    expect(fixture.coordinator.acceptPort(devtools)).toBe(true);

    devtools.emit({ type: 'payloadra:heartbeat' });
    expect(devtools.sent).toEqual([{ type: 'payloadra:heartbeat-ack' }]);

    devtools.emit({ type: 'payloadra:heartbeat', extra: true });
    expect(devtools.sent).toEqual([{ type: 'payloadra:heartbeat-ack' }]);
    expect(devtools.disconnected).toBe(false);
    fixture.coordinator.stopAll();
  });

  it('injects ISOLATED before MAIN and retires a partial collector on MAIN failure', async () => {
    const coordinatorRef: {
      current: ReturnType<typeof backgroundFixture>['coordinator'] | null;
    } = { current: null };
    const content = new FakePort('payloadra:content', contentSender());
    const worlds: string[] = [];
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn(async (script) => {
          worlds.push(script.world);
          if (script.world === 'ISOLATED') {
            coordinatorRef.current?.acceptPort(content);
            return [{ frameId: 0, documentId: 'document-9' }];
          }
          throw new Error('MAIN blocked');
        }),
      },
    });
    coordinatorRef.current = fixture.coordinator;

    await expect(startBackground(fixture)).resolves.toEqual({
      status: 'network-only',
      reason: 'injection-failed',
    });

    expect(worlds.slice(0, 2)).toEqual(['ISOLATED', 'MAIN']);
    expect(content.sent).toContainEqual({ type: 'payloadra:collector-stop' });
    expect(content.disconnected).toBe(true);
  });

  it('scopes stale MAIN completion cleanup to its exact lease', async () => {
    const firstMain =
      pendingValue<
        readonly { frameId: number; documentId: string; result: string }[]
      >();
    let mainCalls = 0;
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn((script) => {
          const result = [{ frameId: 0, documentId: 'document-9' }] as const;
          if (script.files?.[0] === '/interaction.js') {
            return Promise.resolve(result);
          }
          if (script.files?.[0] !== '/interaction-main.js') {
            return Promise.resolve(result);
          }
          mainCalls += 1;
          const mainResult = [
            {
              frameId: 0,
              documentId: 'document-9',
              result: `hook-${mainCalls}`,
            },
          ] as const;
          return mainCalls === 1 ? firstMain.promise : Promise.resolve(mainResult);
        }),
      },
    });

    const stale = startBackground(fixture);
    await vi.waitFor(() => expect(mainCalls).toBe(1));
    const current = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(current), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    expect(fixture.coordinator.acceptPort(devtools)).toBe(true);
    expect(fixture.coordinator.acceptPort(content)).toBe(true);

    firstMain.resolve([
      {
        frameId: 0,
        documentId: 'document-9',
        result: 'hook-1',
      },
    ]);
    await expect(stale).resolves.toEqual({
      status: 'network-only',
      reason: 'superseded',
    });
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'current-after-stale-main',
        kind: 'click',
        occurredAt: 5_000,
        trust: 'trusted',
      },
    });

    expect(devtools.disconnected).toBe(false);
    expect(devtools.sent).toHaveLength(1);
  });

  it('expires a discarded successful Start without retiring a later claimed owner', async () => {
    vi.useFakeTimers();
    const fixture = backgroundFixture();
    try {
      await startActiveBackground(fixture);
      const claimed = await startActiveBackground(fixture);
      const devtools = new FakePort(devtoolsPortName(claimed), extensionSender());
      const content = new FakePort('payloadra:content', contentSender());
      expect(fixture.coordinator.acceptPort(devtools)).toBe(true);
      expect(fixture.coordinator.acceptPort(content)).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(content.disconnected).toBe(false);
      devtools.emit({ type: 'payloadra:stop' });

      expect(content.sent).toEqual([{ type: 'payloadra:collector-stop' }]);
      expect(content.disconnected).toBe(true);
    } finally {
      fixture.coordinator.stopAll();
      vi.useRealTimers();
    }
  });

  it('clears an unclaimed-lease timer when its exact owner claims it', async () => {
    vi.useFakeTimers();
    const fixture = backgroundFixture();
    try {
      const claimed = await startActiveBackground(fixture);
      const devtools = new FakePort(devtoolsPortName(claimed), extensionSender());
      const content = new FakePort('payloadra:content', contentSender());
      fixture.coordinator.acceptPort(devtools);
      fixture.coordinator.acceptPort(content);

      await vi.advanceTimersByTimeAsync(5_001);
      content.emit({
        type: 'payloadra:interaction',
        event: {
          id: 'claimed-after-expiry-window',
          kind: 'click',
          occurredAt: 6_000,
          trust: 'trusted',
        },
      });

      expect(devtools.sent).toHaveLength(1);
      expect(content.disconnected).toBe(false);
    } finally {
      fixture.coordinator.stopAll();
      vi.useRealTimers();
    }
  });

  it('does not let an expired session timer retire a replacement session', async () => {
    vi.useFakeTimers();
    const fixture = backgroundFixture();
    try {
      await startActiveBackground(fixture);
      fixture.coordinator.stopAll();
      const current = await startActiveBackground(fixture);
      const devtools = new FakePort(devtoolsPortName(current), extensionSender());
      const content = new FakePort('payloadra:content', contentSender());
      fixture.coordinator.acceptPort(devtools);
      fixture.coordinator.acceptPort(content);

      await vi.advanceTimersByTimeAsync(5_001);
      content.emit({
        type: 'payloadra:interaction',
        event: {
          id: 'replacement-survives',
          kind: 'click',
          occurredAt: 7_000,
          trust: 'trusted',
        },
      });

      expect(devtools.sent).toHaveLength(1);
      expect(content.disconnected).toBe(false);
    } finally {
      fixture.coordinator.stopAll();
      vi.useRealTimers();
    }
  });

  it('serializes a delayed old MAIN teardown before installing a replacement hook', async () => {
    const teardown = pendingValue<readonly { frameId: number; documentId: string }[]>();
    const files: string[] = [];
    let mainHookSequence = 0;
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn((script) => {
          if (script.func !== undefined) {
            return teardown.promise;
          }
          const file = script.files?.[0] ?? '';
          files.push(file);
          if (file === '/interaction-main.js') {
            mainHookSequence += 1;
          }
          return Promise.resolve([
            {
              frameId: 0,
              documentId: 'document-9',
              ...(file === '/interaction-main.js'
                ? { result: `hook-${mainHookSequence}` }
                : {}),
            },
          ]);
        }),
      },
    });
    const old = await startActiveBackground(fixture);
    const oldPort = new FakePort(devtoolsPortName(old), extensionSender());
    fixture.coordinator.acceptPort(oldPort);
    oldPort.emit({ type: 'payloadra:stop' });

    const restarting = startBackground(fixture);
    await vi.waitFor(() =>
      expect(files.filter((file) => file === '/interaction.js')).toHaveLength(2),
    );
    expect(files.filter((file) => file === '/interaction-main.js')).toHaveLength(1);

    teardown.resolve([{ frameId: 0, documentId: 'document-9' }]);
    await expect(restarting).resolves.toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(files.filter((file) => file === '/interaction-main.js')).toHaveLength(2);
  });

  it('uses a fixed fallback when MAIN teardown never settles', async () => {
    vi.useFakeTimers();
    let mainHookSequence = 0;
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn((script) => {
          if (script.func !== undefined) {
            return new Promise<readonly { frameId: number; documentId: string }[]>(
              () => undefined,
            );
          }
          const main = script.files?.[0] === '/interaction-main.js';
          if (main) {
            mainHookSequence += 1;
          }
          return Promise.resolve([
            {
              frameId: 0,
              documentId: 'document-9',
              ...(main ? { result: `hook-${mainHookSequence}` } : {}),
            },
          ]);
        }),
      },
    });
    try {
      const old = await startActiveBackground(fixture);
      const oldPort = new FakePort(devtoolsPortName(old), extensionSender());
      fixture.coordinator.acceptPort(oldPort);
      oldPort.emit({ type: 'payloadra:stop' });

      let settled = false;
      const restarting = startBackground(fixture).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(restarting).resolves.toEqual(
        expect.objectContaining({ status: 'active' }),
      );
    } finally {
      fixture.coordinator.stopAll();
      vi.useRealTimers();
    }
  });

  it('does not let an old teardown completing after fallback remove the replacement hook', async () => {
    vi.useFakeTimers();
    const teardownGate = pendingValue<void>();
    const listeners = new Map<string, (event?: unknown) => void>();
    const originalPush = () => 'push-result';
    const originalReplace = () => 'replace-result';
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const mainGlobal: Record<string, unknown> = {};
    const mainEnvironment = {
      global: mainGlobal,
      history,
      addEventListener: (type: string, listener: (event?: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchSignal: () => undefined,
    };
    const result = [{ frameId: 0, documentId: 'document-9' }] as const;
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn((script) => {
          const file = script.files?.[0];
          if (file === '/interaction-main.js') {
            const installation = installMainHistoryHook(mainEnvironment, true);
            return Promise.resolve([
              {
                ...result[0],
                result: installation.token,
              },
            ]);
          }
          if (script.func !== undefined) {
            const expectedToken = script.args?.[0];
            return teardownGate.promise.then(() => {
              if (typeof expectedToken === 'string') {
                teardownMainHistoryHook(expectedToken, mainGlobal);
              }
              return result;
            });
          }
          return Promise.resolve(result);
        }),
      },
    });
    try {
      const old = await startActiveBackground(fixture);
      const oldHookToken = (mainGlobal.__payloadraHistoryHookV1 as { token: string })
        .token;
      const oldPort = new FakePort(devtoolsPortName(old), extensionSender());
      fixture.coordinator.acceptPort(oldPort);
      oldPort.emit({ type: 'payloadra:stop' });

      const restarting = startBackground(fixture);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(restarting).resolves.toEqual(
        expect.objectContaining({ status: 'active' }),
      );

      teardownGate.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const current = mainGlobal.__payloadraHistoryHookV1 as
        { token: string } | undefined;
      expect(current?.token).not.toBe(oldHookToken);
      expect(history.pushState).not.toBe(originalPush);
      expect(history.replaceState).not.toBe(originalReplace);
      expect(history.pushState()).toBe('push-result');
    } finally {
      fixture.coordinator.stopAll();
      vi.useRealTimers();
    }
  });

  it('binds MAIN teardown authority to the exact current isolated collector', async () => {
    const pageListeners = new Map<string, Set<CallableFunction>>();
    const pageSignals: unknown[] = [];
    const addPageListener = (type: string, listener: CallableFunction): void => {
      const listeners = pageListeners.get(type) ?? new Set();
      listeners.add(listener);
      pageListeners.set(type, listeners);
    };
    const removePageListener = (type: string, listener: CallableFunction): void => {
      pageListeners.get(type)?.delete(listener);
    };
    const dispatchPageSignal = (event: unknown): boolean => {
      pageSignals.push(event);
      const type =
        event !== null && typeof event === 'object'
          ? (event as { type?: unknown }).type
          : undefined;
      if (typeof type === 'string') {
        for (const listener of pageListeners.get(type) ?? []) {
          Reflect.apply(listener, undefined, [event]);
        }
      }
      return true;
    };
    const pageWindow: CollectorEnvironment['window'] = {
      addEventListener: (type, listener) => addPageListener(type, listener),
      removeEventListener: (type, listener) => removePageListener(type, listener),
      dispatchEvent: dispatchPageSignal,
    };
    const originalPush = () => 'push-result';
    const originalReplace = () => 'replace-result';
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const mainGlobal: Record<string, unknown> = {};
    const mainEnvironment = {
      global: mainGlobal,
      history,
      addEventListener: addPageListener,
      removeEventListener: removePageListener,
      dispatchSignal: (type: string, detail?: unknown) =>
        dispatchPageSignal({
          type,
          ...(detail === undefined ? {} : { detail }),
        }),
    };
    const coordinatorRef: {
      current: ReturnType<typeof backgroundFixture>['coordinator'] | null;
    } = { current: null };
    let isolatedInjections = 0;
    const oldCollectorRef: {
      current: ReturnType<typeof installInteractionCollector> | null;
    } = { current: null };
    const oldPortsRef: {
      current: ReturnType<typeof linkedContentPorts> | null;
    } = { current: null };
    const mainTokens: string[] = [];
    const installCollector = (
      ports: ReturnType<typeof linkedContentPorts>,
    ): ReturnType<typeof installInteractionCollector> =>
      installInteractionCollector({
        global: {},
        document: new FakeEventHub(),
        window: pageWindow,
        connect: () => {
          coordinatorRef.current?.acceptPort(ports.background);
          return ports.isolated;
        },
        currentUrl: () => 'https://shop.test/cart',
        now: () => 1_000,
        nextId: () => 'integrated-event',
        createSignal: (type: string, detail?: unknown) => ({
          type,
          ...(detail === undefined ? {} : { detail }),
        }),
      });
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn((script) => {
          const result = [{ frameId: 0, documentId: 'document-9' }] as const;
          if (script.files?.[0] === '/interaction.js') {
            isolatedInjections += 1;
            if (isolatedInjections === 1) {
              oldPortsRef.current = linkedContentPorts();
              oldCollectorRef.current = installCollector(oldPortsRef.current);
            }
            return Promise.resolve(result);
          }
          if (script.files?.[0] === '/interaction-main.js') {
            const installation = installMainHistoryHook(mainEnvironment, true);
            mainTokens.push(installation.token);
            return Promise.resolve([
              {
                ...result[0],
                result: installation.token,
              },
            ]);
          }
          const expectedToken = script.args?.[0];
          if (typeof expectedToken === 'string') {
            teardownMainHistoryHook(expectedToken, mainGlobal);
          }
          return Promise.resolve(result);
        }),
      },
    });
    coordinatorRef.current = fixture.coordinator;

    try {
      await startActiveBackground(fixture);
      const oldToken = mainTokens[0];
      expect(oldToken).toEqual(expect.any(String));
      expect(history.pushState).not.toBe(originalPush);

      const oldPorts = oldPortsRef.current;
      const oldCollector = oldCollectorRef.current;
      if (oldPorts === null || oldCollector === null) {
        throw new Error('Expected the initial isolated collector to install.');
      }
      oldPorts.background.disconnect();
      await startActiveBackground(fixture);
      const currentToken = mainTokens[1];
      expect(currentToken).toEqual(expect.any(String));
      expect(currentToken).not.toBe(oldToken);

      dispatchPageSignal({
        type: 'payloadra:collector-config',
        detail: { mainHookToken: currentToken },
      });
      oldPorts.isolated.emit({
        type: 'payloadra:collector-config',
        mainHookToken: 'x'.repeat(129),
      });
      oldCollector.stop();

      const staleTeardown = pageSignals.filter(
        (signal) =>
          signal !== null &&
          typeof signal === 'object' &&
          (signal as { type?: unknown }).type === 'payloadra:history-teardown-v1',
      );
      expect(staleTeardown).toEqual([
        {
          type: 'payloadra:history-teardown-v1',
          detail: { token: oldToken },
        },
      ]);
      expect(history.pushState).not.toBe(originalPush);

      const currentPorts = linkedContentPorts();
      installCollector(currentPorts);
      currentPorts.isolated.disconnect();

      expect(
        pageSignals.filter(
          (signal) =>
            signal !== null &&
            typeof signal === 'object' &&
            (signal as { type?: unknown }).type === 'payloadra:history-teardown-v1',
        ),
      ).toEqual([
        {
          type: 'payloadra:history-teardown-v1',
          detail: { token: oldToken },
        },
        {
          type: 'payloadra:history-teardown-v1',
          detail: { token: currentToken },
        },
      ]);
      expect(history.pushState).toBe(originalPush);
      expect(history.replaceState).toBe(originalReplace);
    } finally {
      fixture.coordinator.stopAll();
    }
  });
});

describe('role-scoped ports and sender binding', () => {
  it('routes only events from the bound main-frame document to its DevTools ports', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());

    expect(fixture.coordinator.acceptPort(devtools)).toBe(true);
    expect(fixture.coordinator.acceptPort(content)).toBe(true);
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'click-1',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
        target: {
          tag: 'button',
          role: 'button',
          name: 'save',
          id: 'save-button',
          text: 'Save',
        },
        url: 'https://shop.test/cart',
      },
    });
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'click-2',
        kind: 'click',
        occurredAt: 1_001,
        trust: 'trusted',
        target: { tag: 'a', text: 'Open' },
      },
    });
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'click-3',
        kind: 'click',
        occurredAt: 1_002,
        trust: 'trusted',
        target: { tag: 'button' },
      },
    });

    expect(devtools.sent).toEqual([
      {
        type: 'payloadra:interaction',
        event: {
          id: 'click-1',
          tabId: '9',
          kind: 'click',
          occurredAt: 1_000,
          trust: 'trusted',
          target: {
            tag: 'button',
            role: 'button',
            name: 'save',
            id: 'save-button',
            text: 'Save',
          },
          url: 'https://shop.test/cart',
        },
      },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'click-2',
          tabId: '9',
          kind: 'click',
          occurredAt: 1_001,
          trust: 'trusted',
          target: { tag: 'a', text: 'Open' },
        },
      },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'click-3',
          tabId: '9',
          kind: 'click',
          occurredAt: 1_002,
          trust: 'trusted',
          target: { tag: 'button' },
        },
      },
    ]);
  });

  it.each([
    ['wrong extension', contentSender({ id: 'attacker' })],
    ['wrong tab', contentSender({ tab: { id: 10, url: 'https://shop.test' } })],
    ['child frame', contentSender({ frameId: 2 })],
    ['wrong origin', contentSender({ origin: 'https://evil.test' })],
    ['wrong URL', contentSender({ url: 'https://evil.test/frame' })],
    ['stale document', contentSender({ documentId: 'old-document' })],
    ['missing document', contentSender({ documentId: undefined })],
  ])('rejects a content port with %s', async (_name, sender) => {
    const fixture = backgroundFixture();
    await startBackground(fixture);
    const content = new FakePort('payloadra:content', sender);

    expect(fixture.coordinator.acceptPort(content)).toBe(false);
    expect(content.disconnected).toBe(true);
  });

  it('rejects wrong role names and non-extension DevTools senders', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const wrongRole = new FakePort(
      `${devtoolsPortName(started)}:extra`,
      extensionSender(),
    );
    const pageSender = new FakePort(devtoolsPortName(started), contentSender());

    expect(fixture.coordinator.acceptPort(wrongRole)).toBe(false);
    expect(fixture.coordinator.acceptPort(pageSender)).toBe(false);
    expect(wrongRole.disconnected).toBe(true);
    expect(pageSender.disconnected).toBe(true);
  });

  it('rejects duplicate content ports and spoofed payload identity fields', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const first = new FakePort('payloadra:content', contentSender());
    const duplicate = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);

    expect(fixture.coordinator.acceptPort(first)).toBe(true);
    expect(fixture.coordinator.acceptPort(duplicate)).toBe(false);
    first.emit({
      type: 'payloadra:interaction',
      tabId: 10,
      origin: 'https://evil.test',
      documentId: 'document-9',
      event: {
        id: 'spoof',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
      },
    });

    expect(devtools.sent).toEqual([]);
  });

  it('rejects unsafe event shapes, uppercase descriptors, and sensitive URL forms', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(content);
    const invalidEvents = [
      {
        id: '',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
      },
      {
        id: 'wrong-trust',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'untrusted-hint',
      },
      {
        id: 'trusted-history',
        kind: 'history',
        occurredAt: 1_000,
        trust: 'trusted',
      },
      {
        id: 'uppercase',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
        target: { tag: 'BUTTON' },
      },
      {
        id: 'query-url',
        kind: 'navigation',
        occurredAt: 1_000,
        trust: 'trusted',
        url: 'https://shop.test/cart?secret=x',
      },
      {
        id: 'other-origin',
        kind: 'navigation',
        occurredAt: 1_000,
        trust: 'trusted',
        url: 'https://evil.test/cart',
      },
    ];

    for (const event of invalidEvents) {
      content.emit({ type: 'payloadra:interaction', event });
    }

    expect(devtools.sent).toEqual([]);
  });

  it('rebinds content after disconnect and stopAll tears down every tab once', async () => {
    const fixture = backgroundFixture();
    await startBackground(fixture);
    await startBackground(fixture, 10, 'https://other.test/dashboard');
    const first9 = new FakePort('payloadra:content', contentSender());
    const content10 = new FakePort(
      'payloadra:content',
      contentSender({
        tab: { id: 10, url: 'https://other.test/dashboard' },
        documentId: 'document-10',
        url: 'https://other.test/dashboard',
        origin: 'https://other.test',
      }),
    );
    fixture.coordinator.acceptPort(first9);
    fixture.coordinator.acceptPort(content10);
    first9.disconnect();
    const replacement9 = new FakePort('payloadra:content', contentSender());

    expect(fixture.coordinator.acceptPort(replacement9)).toBe(true);
    fixture.coordinator.stopAll();
    fixture.coordinator.stopAll();

    expect(replacement9.sent).toEqual([{ type: 'payloadra:collector-stop' }]);
    expect(content10.sent).toEqual([{ type: 'payloadra:collector-stop' }]);
  });

  it('rejects absent sessions, unrelated roles, and unsafe numeric port names', () => {
    const fixture = backgroundFixture();
    const noSession = new FakePort(
      'payloadra:devtools:9:missing-lease',
      extensionSender(),
    );
    const unrelated = new FakePort('other-role', extensionSender());
    const unsafeNumber = new FakePort(
      'payloadra:devtools:999999999999999999999:missing-lease',
      extensionSender(),
    );

    expect(fixture.coordinator.acceptPort(noSession)).toBe(false);
    expect(fixture.coordinator.acceptPort(unrelated)).toBe(false);
    expect(fixture.coordinator.acceptPort(unsafeNumber)).toBe(false);
  });

  it('tears down only the matching tab and survives disconnect ordering', async () => {
    const fixture = backgroundFixture();
    const started9 = await startActiveBackground(fixture);
    const started10 = await startActiveBackground(
      fixture,
      10,
      'https://other.test/dashboard',
    );
    const devtools9 = new FakePort(devtoolsPortName(started9), extensionSender());
    const devtools10 = new FakePort(devtoolsPortName(started10), extensionSender());
    const content9 = new FakePort('payloadra:content', contentSender());
    const content10 = new FakePort(
      'payloadra:content',
      contentSender({
        tab: { id: 10, url: 'https://other.test/dashboard' },
        documentId: 'document-10',
        url: 'https://other.test/dashboard',
        origin: 'https://other.test',
      }),
    );
    fixture.coordinator.acceptPort(devtools9);
    fixture.coordinator.acceptPort(devtools10);
    fixture.coordinator.acceptPort(content9);
    fixture.coordinator.acceptPort(content10);

    devtools9.emit({ type: 'payloadra:stop' });
    devtools9.disconnect();
    devtools9.disconnect();

    expect(content9.sent).toEqual([{ type: 'payloadra:collector-stop' }]);
    expect(content10.sent).toEqual([]);
    expect(devtools10.disconnected).toBe(false);
  });

  it('ignores and disconnects stale content after Stop', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(content);

    devtools.emit({ type: 'payloadra:stop' });
    const sentBeforeStaleMessage = devtools.sent.length;
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'stale',
        kind: 'click',
        occurredAt: 2_000,
        trust: 'trusted',
      },
    });

    expect(content.disconnected).toBe(true);
    expect(devtools.sent).toHaveLength(sentBeforeStaleMessage);
  });

  it('retires stale content authority after same-origin document replacement', async () => {
    let documentId = 'document-9';
    let mainHookSequence = 0;
    const fixture = backgroundFixture({
      scripting: {
        executeScript: vi.fn(async (script) => {
          const main = script.files?.[0] === '/interaction-main.js';
          if (main) {
            mainHookSequence += 1;
          }
          return [
            {
              frameId: 0,
              documentId,
              ...(main ? { result: `hook-${mainHookSequence}` } : {}),
            },
          ];
        }),
      },
    });
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const staleContent = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(staleContent);

    documentId = 'document-new';
    await startBackground(fixture);
    staleContent.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'stale-document',
        kind: 'click',
        occurredAt: 2_000,
        trust: 'trusted',
      },
    });

    expect(staleContent.disconnected).toBe(true);
    expect(devtools.sent).toEqual([]);
  });

  it('does not let a stale DevTools port stop a newer tab session', async () => {
    const fixture = backgroundFixture();
    const staleStart = await startActiveBackground(fixture);
    const staleDevtools = new FakePort(devtoolsPortName(staleStart), extensionSender());
    fixture.coordinator.acceptPort(staleDevtools);
    fixture.coordinator.stopAll();

    const currentStart = await startActiveBackground(fixture);
    const currentDevtools = new FakePort(
      devtoolsPortName(currentStart),
      extensionSender(),
    );
    const currentContent = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(currentDevtools);
    fixture.coordinator.acceptPort(currentContent);

    staleDevtools.emit({ type: 'payloadra:stop' });
    currentContent.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'current',
        kind: 'click',
        occurredAt: 3_000,
        trust: 'trusted',
      },
    });

    expect(currentContent.sent).toEqual([]);
    expect(currentDevtools.sent).toHaveLength(1);
  });

  it('keeps a shared collector until the last DevTools owner stops or disconnects', async () => {
    const fixture = backgroundFixture();
    const firstStart = await startActiveBackground(fixture);
    const secondStart = await startActiveBackground(fixture);
    const first = new FakePort(devtoolsPortName(firstStart), extensionSender());
    const second = new FakePort(devtoolsPortName(secondStart), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(first);
    fixture.coordinator.acceptPort(second);
    fixture.coordinator.acceptPort(content);

    first.emit({ type: 'payloadra:stop' });
    content.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'second-owner',
        kind: 'click',
        occurredAt: 4_000,
        trust: 'trusted',
      },
    });

    expect(content.sent).toEqual([]);
    expect(first.sent).toEqual([]);
    expect(second.sent).toHaveLength(1);

    second.disconnect();
    expect(content.sent).toEqual([{ type: 'payloadra:collector-stop' }]);
    expect(content.disconnected).toBe(true);
  });

  it('fails closed without getters for hostile inbound message records', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(content);
    let getterReads = 0;
    const accessorMessage = Object.defineProperty({}, 'type', {
      enumerable: true,
      get() {
        getterReads += 1;
        return 'payloadra:interaction';
      },
    });
    const proxyMessage = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile ownKeys');
        },
      },
    );

    expect(() => content.emit(accessorMessage)).not.toThrow();
    expect(() => content.emit(proxyMessage)).not.toThrow();
    await expect(
      fixture.coordinator.handleStart(proxyMessage, extensionSender()),
    ).resolves.toEqual({
      status: 'network-only',
      reason: 'invalid-request',
    });
    expect(getterReads).toBe(0);
    expect(devtools.sent).toEqual([]);
  });

  it('rejects inbound records beyond clone depth, shape, key, and string budgets', async () => {
    const fixture = backgroundFixture();
    let nested: Record<string, unknown> = { value: true };
    for (let depth = 0; depth < 6; depth += 1) {
      nested = { nested };
    }
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`key${index}`, index]),
    );
    const withSymbol = {
      type: 'payloadra:start-interactions',
      tabId: 9,
      url: 'https://shop.test',
      [Symbol('secret')]: 'hidden',
    };
    const messages: unknown[] = [
      [],
      new Date(),
      tooManyKeys,
      withSymbol,
      {
        type: 'payloadra:start-interactions',
        tabId: 9,
        url: 'https://shop.test',
        nested,
      },
      {
        type: 'payloadra:start-interactions',
        tabId: 9,
        url: `https://shop.test/${'x'.repeat(9_000)}`,
      },
    ];

    for (const message of messages) {
      await expect(
        fixture.coordinator.handleStart(message, extensionSender()),
      ).resolves.toEqual({
        status: 'network-only',
        reason: 'invalid-request',
      });
    }
    expect(fixture.permissions.request).not.toHaveBeenCalled();
  });

  it('ignores object-valued interaction kind and trust enums without coercion', async () => {
    const fixture = backgroundFixture();
    const started = await startActiveBackground(fixture);
    const devtools = new FakePort(devtoolsPortName(started), extensionSender());
    const content = new FakePort('payloadra:content', contentSender());
    fixture.coordinator.acceptPort(devtools);
    fixture.coordinator.acceptPort(content);
    const invalidEnums = [
      {
        id: 'object-kind',
        kind: Object.create(null),
        occurredAt: 1_000,
        trust: 'trusted',
      },
      {
        id: 'object-trust',
        kind: 'click',
        occurredAt: 1_001,
        trust: Object.create(null),
      },
    ];

    for (const event of invalidEnums) {
      expect(() =>
        content.emit({ type: 'payloadra:interaction', event }),
      ).not.toThrow();
    }
    expect(devtools.sent).toEqual([]);
  });
});

describe('panel interaction source', () => {
  it('sends Start synchronously, connects a tab-scoped port, and publishes events', async () => {
    const port = new FakePort('payloadra:devtools:9');
    let resolveStart!: (value: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      resolveStart = resolve;
    });
    const runtime = {
      sendMessage: vi.fn(() => response),
      connect: vi.fn(() => port),
    };
    const source = createInteractionSource(runtime);
    const received: unknown[] = [];
    const unsubscribe = source.subscribe((event) => received.push(event));

    const starting = source.start({
      tabId: 9,
      url: 'https://shop.test/cart?secret=x',
    });

    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: 'payloadra:start-interactions',
      tabId: 9,
      url: 'https://shop.test/cart?secret=x',
    });
    expect(runtime.connect).not.toHaveBeenCalled();
    resolveStart({
      status: 'active',
      tabId: 9,
      origin: 'https://shop.test',
      documentId: 'document-9',
      leaseId: 'lease-panel-9',
    });
    await expect(starting).resolves.toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(runtime.connect).toHaveBeenCalledWith({
      name: 'payloadra:devtools:9:lease-panel-9',
    });

    port.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'event',
        tabId: '9',
        kind: 'navigation',
        occurredAt: 1_000,
        trust: 'trusted',
        url: 'https://shop.test/cart',
      },
    });
    expect(received).toHaveLength(1);
    unsubscribe();
    port.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'ignored',
        tabId: '9',
        kind: 'click',
        occurredAt: 1_001,
        trust: 'trusted',
      },
    });
    expect(received).toHaveLength(1);
  });

  it('keeps denial non-fatal and makes Stop idempotent', async () => {
    const runtime = {
      sendMessage: vi.fn(async () => ({
        status: 'network-only',
        reason: 'permission-denied',
      })),
      connect: vi.fn(() => new FakePort('unused')),
    };
    const source = createInteractionSource(runtime);

    await expect(source.start({ tabId: 9, url: 'https://shop.test' })).resolves.toEqual(
      {
        status: 'network-only',
        reason: 'permission-denied',
      },
    );
    await source.stop();
    await source.stop();
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it('sends a bounded heartbeat while active and cancels it on Stop', async () => {
    vi.useFakeTimers();
    const port = new FakePort('payloadra:devtools:9');
    const runtime = {
      sendMessage: vi.fn(async () => ({
        status: 'active',
        tabId: 9,
        origin: 'https://shop.test',
        documentId: 'document-9',
        leaseId: 'lease-heartbeat-9',
      })),
      connect: vi.fn(() => port),
    };
    const source = createInteractionSource(runtime);
    try {
      await source.start({ tabId: 9, url: 'https://shop.test' });

      await vi.advanceTimersByTimeAsync(19_999);
      expect(port.sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(port.sent).toEqual([{ type: 'payloadra:heartbeat' }]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(port.sent).toEqual([
        { type: 'payloadra:heartbeat' },
        { type: 'payloadra:heartbeat' },
      ]);

      await source.stop();
      expect(port.sent.at(-1)).toEqual({ type: 'payloadra:stop' });
      const sentAfterStop = port.sent.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(port.sent).toHaveLength(sentAfterStop);
    } finally {
      await source.stop();
      vi.useRealTimers();
    }
  });

  it('stops and disconnects an active port once and ignores malformed events', async () => {
    const port = new FakePort('payloadra:devtools:9');
    const runtime = {
      sendMessage: vi.fn(async () => ({
        status: 'active',
        tabId: 9,
        origin: 'https://shop.test',
        documentId: 'document-9',
        leaseId: 'lease-stop-9',
      })),
      connect: vi.fn(() => port),
    };
    const source = createInteractionSource(runtime);
    const listener = vi.fn();
    source.subscribe(listener);
    await source.start({ tabId: 9, url: 'https://shop.test' });

    port.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'leak',
        tabId: '9',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
        value: 'secret',
      },
    });
    await source.stop();
    await source.stop();

    expect(listener).not.toHaveBeenCalled();
    expect(port.sent).toEqual([{ type: 'payloadra:stop' }]);
    expect(port.disconnected).toBe(true);
  });

  it('fails closed for malformed/rejected Start responses and isolates subscribers', async () => {
    const malformedResponses = [
      null,
      { status: 'network-only', reason: 'made-up' },
      {
        status: 'active',
        tabId: -1,
        origin: 'chrome://settings',
        documentId: '',
      },
    ];
    for (const response of malformedResponses) {
      const source = createInteractionSource({
        sendMessage: vi.fn(async () => response),
        connect: vi.fn(() => new FakePort('unused')),
      });
      await expect(
        source.start({ tabId: 9, url: 'https://shop.test' }),
      ).resolves.toEqual({
        status: 'network-only',
        reason: 'invalid-response',
      });
    }

    const throwingSource = createInteractionSource({
      sendMessage: () => {
        throw new Error('extension reloaded');
      },
      connect: () => new FakePort('unused'),
    });
    await expect(
      throwingSource.start({ tabId: 9, url: 'https://shop.test' }),
    ).resolves.toEqual({
      status: 'network-only',
      reason: 'invalid-response',
    });

    const port = new FakePort('payloadra:devtools:9');
    const source = createInteractionSource({
      sendMessage: vi.fn(async () => ({
        status: 'active',
        tabId: 9,
        origin: 'https://shop.test',
        documentId: 'document-9',
        leaseId: 'lease-survivor-9',
      })),
      connect: () => port,
    });
    const survivor = vi.fn();
    source.subscribe(() => {
      throw new Error('broken subscriber');
    });
    source.subscribe(survivor);
    await source.start({ tabId: 9, url: 'https://shop.test' });
    port.emit({
      type: 'payloadra:interaction',
      event: {
        id: 'safe',
        tabId: '9',
        kind: 'click',
        occurredAt: 1_000,
        trust: 'trusted',
      },
    });
    port.disconnect();
    await source.stop();

    expect(survivor).toHaveBeenCalledOnce();
    expect(port.sent).toEqual([]);
  });

  it('does not resurrect a pending Start after Stop', async () => {
    const startGate = pendingValue<unknown>();
    const port = new FakePort('payloadra:devtools:9');
    const runtime = {
      sendMessage: vi.fn(() => startGate.promise),
      connect: vi.fn(() => port),
    };
    const source = createInteractionSource(runtime);

    const starting = source.start({
      tabId: 9,
      url: 'https://shop.test',
    });
    const stopping = source.stop();
    startGate.resolve({
      status: 'active',
      tabId: 9,
      origin: 'https://shop.test',
      documentId: 'document-9',
      leaseId: 'lease-pending-9',
    });

    await stopping;
    await expect(starting).resolves.toEqual({
      status: 'network-only',
      reason: 'superseded',
    });
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'payloadra:release-interactions',
        tabId: 9,
      }),
    );
  });

  it('keeps only the latest out-of-order concurrent Start result active', async () => {
    const firstGate = pendingValue<unknown>();
    const secondGate = pendingValue<unknown>();
    const firstPort = new FakePort('payloadra:devtools:9');
    const secondPort = new FakePort('payloadra:devtools:10');
    const runtime = {
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(firstGate.promise)
        .mockReturnValueOnce(secondGate.promise)
        .mockResolvedValue(undefined),
      connect: vi.fn().mockReturnValueOnce(secondPort).mockReturnValueOnce(firstPort),
    };
    const source = createInteractionSource(runtime);
    const first = source.start({ tabId: 9, url: 'https://shop.test' });
    const second = source.start({ tabId: 10, url: 'https://other.test' });

    secondGate.resolve({
      status: 'active',
      tabId: 10,
      origin: 'https://other.test',
      documentId: 'document-10',
      leaseId: 'lease-latest-10',
    });
    await expect(second).resolves.toEqual(
      expect.objectContaining({ status: 'active', tabId: 10 }),
    );
    firstGate.resolve({
      status: 'active',
      tabId: 9,
      origin: 'https://shop.test',
      documentId: 'document-9',
      leaseId: 'lease-stale-9',
    });
    await expect(first).resolves.toEqual({
      status: 'network-only',
      reason: 'superseded',
    });

    expect(runtime.connect).toHaveBeenCalledTimes(1);
    await source.stop();
    expect(secondPort.disconnected).toBe(true);
    expect(firstPort.disconnected).toBe(false);
  });
});

describe('isolated interaction collector', () => {
  it('captures only trusted click/submit/navigation events with safe URLs', () => {
    const fixture = collectorFixture();
    const button = fakeElement('button', {}, 'Save');
    const form = fakeElement('form', { id: 'checkout' }, 'private');
    installInteractionCollector(fixture.environment);

    fixture.document.emit('click', {
      isTrusted: false,
      composedPath: () => [button],
    });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () =>
        Array.from({ length: 40 }, (_, index) => (index === 31 ? button : {})),
    });
    fixture.document.emit('submit', {
      isTrusted: true,
      target: form,
    });
    fixture.window.emit('popstate', { isTrusted: true });
    fixture.setHref('https://shop.test/next?password=secret#hidden');
    fixture.window.emit('hashchange', { isTrusted: true });

    expect(fixture.port.sent).toEqual([
      { type: 'payloadra:content-ready' },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'interaction-1',
          kind: 'click',
          occurredAt: 1_001,
          trust: 'trusted',
          target: { tag: 'button', text: 'Save' },
          url: 'https://shop.test/cart',
        },
      },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'interaction-2',
          kind: 'submit',
          occurredAt: 1_002,
          trust: 'trusted',
          target: { tag: 'form', id: 'checkout' },
          url: 'https://shop.test/cart',
        },
      },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'interaction-3',
          kind: 'navigation',
          occurredAt: 1_003,
          trust: 'trusted',
          url: 'https://shop.test/cart',
        },
      },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'interaction-4',
          kind: 'navigation',
          occurredAt: 1_004,
          trust: 'trusted',
          url: 'https://shop.test/next',
        },
      },
    ]);
  });

  it('marks MAIN-world history signals as spoofable metadata-only hints', () => {
    const fixture = collectorFixture();
    installInteractionCollector(fixture.environment);

    fixture.window.emit('payloadra:history-v1', {
      isTrusted: false,
      detail: {
        value: 'password',
        url: 'https://evil.test/?token=secret',
        method: 'pushState',
      },
    });

    expect(fixture.port.sent.at(-1)).toEqual({
      type: 'payloadra:interaction',
      event: {
        id: 'interaction-1',
        kind: 'history',
        occurredAt: 1_001,
        trust: 'untrusted-hint',
        url: 'https://shop.test/cart',
      },
    });
    expect(JSON.stringify(fixture.port.sent)).not.toMatch(/password|evil|token/u);
  });

  it('guards duplicate injection and fully tears down owned listeners', () => {
    const fixture = collectorFixture();
    const first = installInteractionCollector(fixture.environment);
    const second = installInteractionCollector(fixture.environment);

    expect(first.status).toBe('installed');
    expect(second.status).toBe('already-installed');
    expect(fixture.port.sent).toEqual([{ type: 'payloadra:content-ready' }]);

    fixture.port.emit({
      type: 'payloadra:collector-config',
      mainHookToken: 'hook-token',
    });
    fixture.port.emit({ type: 'payloadra:collector-stop' });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [fakeElement('button', {}, 'Ignored')],
    });

    expect(fixture.window.dispatched).toEqual([
      {
        type: 'payloadra:history-teardown-v1',
        detail: { token: 'hook-token' },
      },
    ]);
    expect(fixture.port.disconnected).toBe(true);
    expect(fixture.global.__payloadraInteractionBridgeV1).toBeUndefined();
    expect(fixture.port.sent).toEqual([{ type: 'payloadra:content-ready' }]);
  });

  it('fails closed when event paths, URLs, or port delivery are hostile', () => {
    const fixture = collectorFixture();
    fixture.environment.connect = () => ({
      name: fixture.port.name,
      sender: fixture.port.sender,
      onMessage: fixture.port.onMessage,
      onDisconnect: fixture.port.onDisconnect,
      postMessage: () => {
        throw new Error('disconnected');
      },
      disconnect: () => fixture.port.disconnect(),
    });
    fixture.setHref('not a URL');
    expect(() => installInteractionCollector(fixture.environment)).not.toThrow();
    expect(() =>
      fixture.document.emit('click', {
        isTrusted: true,
        composedPath: () => {
          throw new Error('hostile');
        },
      }),
    ).not.toThrow();
  });

  it('handles unavailable ports, invalid event metadata, and targetless paths', () => {
    const unavailable = collectorFixture();
    unavailable.environment.connect = () => {
      throw new Error('extension unloaded');
    };
    expect(installInteractionCollector(unavailable.environment).status).toBe(
      'unavailable',
    );

    const fixture = collectorFixture();
    installInteractionCollector(fixture.environment);
    fixture.document.emit('submit', { isTrusted: false });
    fixture.document.emit('submit', { isTrusted: true, target: null });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [null, { localName: 'div' }],
    });
    fixture.environment.nextId = () => '';
    fixture.window.emit('popstate', { isTrusted: true });
    fixture.environment.nextId = () => {
      throw new Error('ID unavailable');
    };
    fixture.window.emit('hashchange', { isTrusted: true });

    expect(fixture.port.sent).toEqual([
      { type: 'payloadra:content-ready' },
      {
        type: 'payloadra:interaction',
        event: {
          id: 'interaction-1',
          kind: 'click',
          occurredAt: 1_001,
          trust: 'trusted',
          url: 'https://shop.test/cart',
        },
      },
    ]);
  });

  it('keeps teardown idempotent when MAIN signaling throws', () => {
    const fixture = collectorFixture();
    fixture.environment.createSignal = () => {
      throw new Error('page gone');
    };
    const installation = installInteractionCollector(fixture.environment);
    fixture.port.emit({
      type: 'payloadra:collector-config',
      mainHookToken: 'hook-token',
    });

    expect(() => installation.stop()).not.toThrow();
    expect(() => installation.stop()).not.toThrow();
    expect(fixture.port.disconnected).toBe(true);
  });

  it('reads actionable DOM text with a bounded node walk and fails closed at every cap', () => {
    const fixture = collectorFixture();
    installInteractionCollector(fixture.environment);
    const element = (childNodes: unknown) => ({
      localName: 'button',
      getAttribute: () => null,
      childNodes,
    });
    const children = (...nodes: unknown[]) =>
      Object.assign({ length: nodes.length }, nodes);

    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [
        element(
          children(
            null,
            'ignored',
            { nodeType: 3, nodeValue: 7 },
            { nodeType: 3, nodeValue: 'Save ' },
            {
              nodeType: 1,
              localName: 'span',
              isContentEditable: false,
              getAttribute: () => null,
              childNodes: children({ nodeType: 4, nodeValue: 'now' }),
            },
            {
              nodeType: 1,
              localName: 'span',
              isContentEditable: false,
              getAttribute: () => 'false',
              childNodes: children({ nodeType: 3, nodeValue: ' safe' }),
            },
          ),
        ),
      ],
    });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [
        element(children({ nodeType: 3, nodeValue: 'x'.repeat(513) })),
      ],
    });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [element({ length: 257 })],
    });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [
        element(
          Object.defineProperty({}, 'length', {
            get: () => {
              throw new Error('hostile node list');
            },
          }),
        ),
      ],
    });
    let chain: unknown = { nodeType: 3, nodeValue: 'too deep' };
    for (let index = 0; index < 257; index += 1) {
      chain = { nodeType: 1, childNodes: children(chain) };
    }
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [element(children(chain))],
    });

    const events = fixture.port.sent.slice(1) as {
      event: { target?: { tag: string; text?: string } };
    }[];
    expect(events).toHaveLength(5);
    expect(events[0]?.event.target).toEqual({
      tag: 'button',
      text: 'Save now safe',
    });
    expect(events.slice(1).map((message) => message.event.target)).toEqual([
      { tag: 'button' },
      { tag: 'button' },
      { tag: 'button' },
      { tag: 'button' },
    ]);
  });

  it('never reads forbidden or editable descendant text inside actionable roots', () => {
    const fixture = collectorFixture();
    installInteractionCollector(fixture.environment);
    const children = (...nodes: unknown[]) =>
      Object.assign({ length: nodes.length }, nodes);
    const reads: string[] = [];
    const secretText = (name: string) =>
      Object.defineProperties(
        { nodeType: 3 },
        {
          nodeValue: {
            enumerable: true,
            get: () => {
              reads.push(name);
              return `${name}=secret-value`;
            },
          },
        },
      );
    const subtree = (
      localName: string,
      name: string,
      options: { editable?: boolean; attribute?: string | null } = {},
    ) => ({
      nodeType: 1,
      localName,
      isContentEditable: options.editable ?? false,
      getAttribute: (attribute: string) =>
        attribute === 'contenteditable' ? (options.attribute ?? null) : null,
      childNodes: children(secretText(name)),
    });
    const actionable = (
      localName: 'a' | 'button',
      childNodes: unknown,
      isContentEditable = false,
    ) => ({
      nodeType: 1,
      localName,
      isContentEditable,
      getAttribute: () => null,
      childNodes,
    });

    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [
        actionable(
          'button',
          children(
            { nodeType: 3, nodeValue: 'Safe ' },
            subtree('textarea', 'textarea'),
            subtree('input', 'input'),
            subtree('select', 'select'),
            subtree('form', 'form'),
            subtree('span', 'explicit-editable', {
              editable: true,
              attribute: 'true',
            }),
            { nodeType: 3, nodeValue: 'submit' },
          ),
        ),
      ],
    });
    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [
        actionable(
          'a',
          children(
            { nodeType: 3, nodeValue: 'Open' },
            subtree('span', 'inherited-editable', { editable: true }),
          ),
        ),
      ],
    });

    expect(reads).toEqual([]);
    expect(fixture.port.sent.slice(1)).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          target: { tag: 'button', text: 'Safe submit' },
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          target: { tag: 'a', text: 'Open' },
        }),
      }),
    ]);
    expect(JSON.stringify(fixture.port.sent)).not.toMatch(
      /textarea|input|select|form|editable|secret-value/u,
    );
  });

  it('never reads descendants when the actionable root is inherited-editable', () => {
    const fixture = collectorFixture();
    installInteractionCollector(fixture.environment);
    let textReads = 0;
    const secret = Object.defineProperties(
      { nodeType: 3 },
      {
        nodeValue: {
          get: () => {
            textReads += 1;
            return 'password=secret-value';
          },
        },
      },
    );
    const button = {
      nodeType: 1,
      localName: 'button',
      isContentEditable: true,
      getAttribute: () => null,
      childNodes: Object.assign({ length: 1 }, [secret]),
    };

    fixture.document.emit('click', {
      isTrusted: true,
      composedPath: () => [button],
    });

    expect(textReads).toBe(0);
    expect(fixture.port.sent.at(-1)).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          target: { tag: 'button' },
        }),
      }),
    );
    expect(JSON.stringify(fixture.port.sent)).not.toContain('secret-value');
  });
});

describe('MAIN-world history hook', () => {
  it('wraps pushState and replaceState with metadata-only signals', () => {
    const dispatched: unknown[] = [];
    const calls: string[] = [];
    const originalPush = function (this: unknown, _state: unknown): string {
      void _state;
      calls.push(this === history ? 'push' : 'wrong-this');
      return 'push-result';
    };
    const originalReplace = function (): string {
      calls.push('replace');
      return 'replace-result';
    };
    const listeners = new Map<string, () => void>();
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const global: Record<string, unknown> = {};
    const environment = {
      global,
      history,
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchSignal: (type: string) => dispatched.push({ type }),
    };

    const installed = installMainHistoryHook(environment);
    const pushResult = history.pushState({ password: 'secret' });
    const replaceResult = history.replaceState();

    expect(installed.status).toBe('installed');
    expect(pushResult).toBe('push-result');
    expect(replaceResult).toBe('replace-result');
    expect(calls).toEqual(['push', 'replace']);
    expect(dispatched).toEqual([
      { type: 'payloadra:history-v1' },
      { type: 'payloadra:history-v1' },
    ]);
    expect(JSON.stringify(dispatched)).not.toContain('secret');
    installed.stop();
    installed.stop();
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });

  it('guards duplicates and restores only methods still owned by the hook', () => {
    const listeners = new Map<string, (event?: unknown) => void>();
    const originalPush = () => undefined;
    const originalReplace = () => undefined;
    const pageReplacement = () => undefined;
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const environment = {
      global: {} as Record<string, unknown>,
      history,
      addEventListener: (type: string, listener: (event?: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchSignal: () => undefined,
    };

    const installed = installMainHistoryHook(environment);
    expect(installed.status).toBe('installed');
    expect(installMainHistoryHook(environment).status).toBe('already-installed');
    history.pushState = pageReplacement;
    listeners.get('payloadra:history-teardown-v1')?.({
      detail: { token: installed.token },
    });

    expect(history.pushState).toBe(pageReplacement);
    expect(history.replaceState).toBe(originalReplace);
    expect(environment.global.__payloadraHistoryHookV1).toBeUndefined();
    expect(listeners.has('payloadra:history-teardown-v1')).toBe(false);
  });

  it('never lets telemetry dispatch alter history return or throw behavior', () => {
    const originalError = new Error('history failed');
    const history = {
      pushState: () => 'original-result',
      replaceState: () => {
        throw originalError;
      },
    };
    const environment = {
      global: {} as Record<string, unknown>,
      history,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchSignal: () => {
        throw new Error('page blocked signal');
      },
    };
    installMainHistoryHook(environment);

    expect(history.pushState()).toBe('original-result');
    expect(() => history.replaceState()).toThrow(originalError);
  });

  it('rolls back owned patches when MAIN hook installation is partial', () => {
    const originalPush = () => undefined;
    const originalReplace = () => undefined;
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const listenerFailure = {
      global: {} as Record<string, unknown>,
      history,
      addEventListener: () => {
        throw new Error('listener rejected');
      },
      removeEventListener: () => undefined,
      dispatchSignal: () => undefined,
    };

    expect(() => installMainHistoryHook(listenerFailure)).not.toThrow();
    expect(installMainHistoryHook(listenerFailure).status).toBe('unavailable');
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);

    const assignmentFailureHistory = {
      replaceState: originalReplace,
    } as unknown as {
      pushState: CallableFunction;
      replaceState: CallableFunction;
    };
    Object.defineProperty(assignmentFailureHistory, 'pushState', {
      configurable: true,
      get: () => originalPush,
      set: () => {
        throw new Error('patch rejected');
      },
    });
    expect(
      installMainHistoryHook({
        ...listenerFailure,
        global: {},
        history: assignmentFailureHistory,
        addEventListener: () => undefined,
      }).status,
    ).toBe('unavailable');
    expect(assignmentFailureHistory.pushState).toBe(originalPush);
  });

  it('supports direct idempotent teardown scoped to an exact MAIN hook token', () => {
    const originalPush = () => undefined;
    const originalReplace = () => undefined;
    const listeners = new Map<string, (event?: unknown) => void>();
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const environment = {
      global: {} as Record<string, unknown>,
      history,
      addEventListener: (type: string, listener: (event?: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchSignal: () => undefined,
    };
    const installed = installMainHistoryHook(environment);
    teardownMainHistoryHook(installed.token, environment.global);
    teardownMainHistoryHook(installed.token, environment.global);
    const replacement = installMainHistoryHook(environment);
    const replacementPush = history.pushState;
    teardownMainHistoryHook(installed.token, environment.global);
    expect(history.pushState).toBe(replacementPush);

    const hostileGlobal = {
      __payloadraHistoryHookV1: {
        token: 'hostile-token',
        stop: () => {
          throw new Error('page disappeared');
        },
      },
    };
    expect(() => teardownMainHistoryHook('hostile-token', hostileGlobal)).not.toThrow();
    teardownMainHistoryHook(replacement.token, environment.global);

    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });

  it('ignores a stale teardown token after a replacement MAIN hook is installed', () => {
    type TeardownListener = (event?: unknown) => void;
    const listeners = new Map<string, TeardownListener>();
    const originalPush = () => undefined;
    const originalReplace = () => undefined;
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    const environment = {
      global: {} as Record<string, unknown>,
      history,
      addEventListener: (type: string, listener: TeardownListener) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchSignal: () => undefined,
    };
    const old = installMainHistoryHook(environment);
    const oldToken = (old as unknown as { token?: unknown }).token;
    old.stop();
    const current = installMainHistoryHook(environment);
    const currentToken = (current as unknown as { token?: unknown }).token;
    const currentPush = history.pushState;

    expect(oldToken).toEqual(expect.any(String));
    expect(currentToken).toEqual(expect.any(String));
    expect(currentToken).not.toBe(oldToken);
    listeners.get('payloadra:history-teardown-v1')?.(null);
    listeners.get('payloadra:history-teardown-v1')?.('forged');
    listeners.get('payloadra:history-teardown-v1')?.({ detail: null });
    listeners.get('payloadra:history-teardown-v1')?.({ detail: 'forged' });
    expect(history.pushState).toBe(currentPush);
    listeners.get('payloadra:history-teardown-v1')?.({
      detail: { token: oldToken },
    });
    expect(history.pushState).toBe(currentPush);

    listeners.get('payloadra:history-teardown-v1')?.({
      detail: { token: currentToken },
    });
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });

  it('rejects hostile methods, silent patches, and missing guards transactionally', () => {
    const originalPush = () => undefined;
    const originalReplace = () => undefined;
    const base = {
      global: {} as Record<string, unknown>,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchSignal: () => undefined,
    };
    const throwingHistory = Object.defineProperty(
      { replaceState: originalReplace },
      'pushState',
      {
        get: () => {
          throw new Error('hostile history');
        },
      },
    ) as unknown as {
      pushState: CallableFunction;
      replaceState: CallableFunction;
    };
    expect(
      installMainHistoryHook({
        ...base,
        history: throwingHistory,
      }).status,
    ).toBe('unavailable');
    expect(
      installMainHistoryHook({
        ...base,
        history: {
          pushState: 'not callable',
          replaceState: originalReplace,
        } as unknown as {
          pushState: CallableFunction;
          replaceState: CallableFunction;
        },
      }).status,
    ).toBe('unavailable');

    for (const blocked of ['pushState', 'replaceState'] as const) {
      const target = {
        pushState: originalPush,
        replaceState: originalReplace,
      };
      const history = new Proxy(target, {
        set(record, property, value) {
          return property === blocked ? true : Reflect.set(record, property, value);
        },
      });
      expect(
        installMainHistoryHook({
          ...base,
          global: {},
          history,
        }).status,
      ).toBe('unavailable');
      expect(history.pushState).toBe(originalPush);
      expect(history.replaceState).toBe(originalReplace);
    }

    const guardRejectingGlobal = new Proxy<Record<string, unknown>>(
      {},
      {
        defineProperty: () => true,
      },
    );
    const history = {
      pushState: originalPush,
      replaceState: originalReplace,
    };
    expect(
      installMainHistoryHook({
        ...base,
        global: guardRejectingGlobal,
        history,
      }).status,
    ).toBe('unavailable');
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });
});
