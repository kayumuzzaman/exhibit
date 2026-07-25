import {
  describeElement,
  describeSubmit,
  type ElementLike,
} from '../../domain/element-label';
import type {
  ElementDescriptor,
  InteractionEvent,
  InteractionTrust,
} from '../../domain/model';
import { redactUnknown, REDACTED } from '../../domain/redaction';
import { DEFAULT_REDACTION_CONFIG } from '../../features/settings/redaction-settings';
import type {
  InteractionSource,
  InteractionStartContext,
  InteractionStartResult,
  InteractionUnavailableReason,
} from '../../ports/interaction-source';
import { deriveOriginPermission, sanitizePageUrl } from './permissions';

const DEVTOOLS_PORT_PREFIX = 'payloadra:devtools:';
const CONTENT_PORT_NAME = 'payloadra:content';
const COLLECTOR_GUARD = '__payloadraInteractionBridgeV1';
const HISTORY_GUARD = '__payloadraHistoryHookV1';
const HISTORY_SIGNAL = 'payloadra:history-v1';
const HISTORY_TEARDOWN_SIGNAL = 'payloadra:history-teardown-v1';
const MAX_EVENT_PATH = 32;
const MAX_EVENT_ID_CODE_POINTS = 128;
const MAX_TEXT_NODES = 256;
const UNCLAIMED_LEASE_TTL_MS = 5_000;
const MAIN_TEARDOWN_FALLBACK_MS = 1_000;
const TEXT_FORBIDDEN_SUBTREE_TAGS = new Set([
  'form',
  'input',
  'label',
  'option',
  'select',
  'textarea',
]);
let mainHookSequence = 0;

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

export interface RuntimeListenerSet<Listener> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

export interface RuntimeSenderLike {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly origin?: string | undefined;
  readonly tab?:
    | Readonly<{
        id?: number | undefined;
        url?: string | undefined;
      }>
    | undefined;
  readonly frameId?: number | undefined;
  readonly documentId?: string | undefined;
}

export interface RuntimePortLike {
  readonly name: string;
  readonly sender?: RuntimeSenderLike | undefined;
  readonly onMessage: RuntimeListenerSet<MessageListener>;
  readonly onDisconnect: RuntimeListenerSet<DisconnectListener>;
  postMessage(message: unknown): void;
  disconnect(): void;
}

type ScriptInjectionTarget = Readonly<{
  target: Readonly<{
    tabId: number;
    frameIds: readonly number[];
  }>;
  world: 'ISOLATED' | 'MAIN';
  injectImmediately: true;
}>;

export type ScriptInjectionLike = ScriptInjectionTarget &
  (
    | Readonly<{
        files: readonly string[];
        func?: never;
        args?: never;
      }>
    | Readonly<{
        files?: never;
        func(expectedToken: string): void;
        args: readonly [expectedToken: string];
      }>
  );

export type InjectionResultLike = Readonly<{
  frameId: number;
  documentId?: string | undefined;
  result?: unknown;
}>;

export interface BackgroundInteractionDependencies {
  readonly extensionId: string;
  readonly permissions: Readonly<{
    request(request: { origins: string[] }): PromiseLike<boolean> | boolean;
  }>;
  readonly tabs: Readonly<{
    get(tabId: number): PromiseLike<
      Readonly<{
        id?: number | undefined;
        url?: string | undefined;
      }>
    >;
  }>;
  readonly scripting: Readonly<{
    executeScript(
      injection: ScriptInjectionLike,
    ): PromiseLike<readonly InjectionResultLike[]>;
  }>;
}

export interface PanelRuntimeLike {
  sendMessage(message: unknown): PromiseLike<unknown>;
  connect(options: { name: string }): RuntimePortLike;
}

type StartCommand = Readonly<{
  type: 'payloadra:start-interactions';
  tabId: number;
  url: string;
}>;

type ReleaseCommand = Readonly<{
  type: 'payloadra:release-interactions';
  tabId: number;
  leaseId: string;
}>;

type RawInteractionEvent = Readonly<{
  id: string;
  kind: InteractionEvent['kind'];
  occurredAt: number;
  trust: InteractionTrust;
  target?: ElementDescriptor;
  url?: string;
}>;

type BackgroundLease = {
  port: RuntimePortLike | null;
  expiry: ReturnType<typeof globalThis.setTimeout> | null;
};

type BackgroundSession = {
  readonly tabId: number;
  readonly origin: string;
  documentId: string | null;
  active: boolean;
  mainHookToken: string | null;
  contentPort: RuntimePortLike | null;
  readonly leases: Map<string, BackgroundLease>;
};

export interface BackgroundInteractionCoordinator {
  handleStart(
    message: unknown,
    sender: RuntimeSenderLike,
  ): Promise<InteractionStartResult>;
  handleRelease(message: unknown, sender: RuntimeSenderLike): Promise<void>;
  acceptPort(port: RuntimePortLike): boolean;
  stopAll(): void;
}

const MAX_INBOUND_DEPTH = 4;
const MAX_INBOUND_KEYS = 16;
const MAX_INBOUND_STRING_CODE_UNITS = 8_192;

type SafeClone = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;

const invalidClone: SafeClone = { ok: false };

function cloneInboundValue(value: unknown, depth = 0): SafeClone {
  if (depth > MAX_INBOUND_DEPTH) {
    return invalidClone;
  }
  if (typeof value === 'string') {
    return value.length <= MAX_INBOUND_STRING_CODE_UNITS
      ? { ok: true, value }
      : invalidClone;
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { ok: true, value };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return invalidClone;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidClone;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return invalidClone;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (names.length > MAX_INBOUND_KEYS) {
    return invalidClone;
  }
  const clone: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidClone;
    }
    const child = cloneInboundValue(descriptor.value, depth + 1);
    if (!child.ok) {
      return invalidClone;
    }
    Object.defineProperty(clone, name, {
      value: child.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ok: true, value: clone };
}

function cloneInboundRecord(value: unknown): Record<string, unknown> | null {
  try {
    const clone = cloneInboundValue(value);
    return clone.ok && isRecord(clone.value) ? clone.value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return false;
  }
  if (
    keys.length < required.length ||
    keys.length > required.length + optional.length
  ) {
    return false;
  }
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isTabId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readStartCommand(value: unknown): StartCommand | null {
  const safe = cloneInboundRecord(value);
  if (
    safe === null ||
    !hasExactKeys(safe, ['type', 'tabId', 'url']) ||
    safe.type !== 'payloadra:start-interactions' ||
    !isTabId(safe.tabId) ||
    typeof safe.url !== 'string'
  ) {
    return null;
  }
  return {
    type: 'payloadra:start-interactions',
    tabId: safe.tabId,
    url: safe.url,
  };
}

function readReleaseCommand(value: unknown): ReleaseCommand | null {
  const safe = cloneInboundRecord(value);
  if (
    safe === null ||
    !hasExactKeys(safe, ['type', 'tabId', 'leaseId']) ||
    safe.type !== 'payloadra:release-interactions' ||
    !isTabId(safe.tabId) ||
    !cappedString(safe.leaseId, 128) ||
    safe.leaseId === ''
  ) {
    return null;
  }
  return {
    type: 'payloadra:release-interactions',
    tabId: safe.tabId,
    leaseId: safe.leaseId,
  };
}

function extensionOrigin(extensionId: string): string {
  return `chrome-extension://${extensionId}`;
}

function isExtensionPageUrl(value: string | undefined, extensionId: string): boolean {
  if (value === undefined || value.length > MAX_INBOUND_STRING_CODE_UNITS) {
    return false;
  }
  try {
    const url = new URL(value);
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

function isExtensionSender(sender: RuntimeSenderLike, extensionId: string): boolean {
  try {
    return (
      sender.id === extensionId &&
      sender.tab === undefined &&
      sender.origin === extensionOrigin(extensionId) &&
      isExtensionPageUrl(sender.url, extensionId)
    );
  } catch {
    return false;
  }
}

function pageOrigin(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const permission = deriveOriginPermission(value);
  return permission.ok ? permission.origin : null;
}

function readInjectionDocument(results: readonly InjectionResultLike[]): string | null {
  if (!Array.isArray(results) || results.length !== 1) {
    return null;
  }
  const result = results[0];
  if (
    result === undefined ||
    result.frameId !== 0 ||
    typeof result.documentId !== 'string' ||
    result.documentId === ''
  ) {
    return null;
  }
  return result.documentId;
}

function readMainInjection(
  results: readonly InjectionResultLike[],
): Readonly<{ documentId: string; token: string }> | null {
  const documentId = readInjectionDocument(results);
  const result = Array.isArray(results) ? results[0] : undefined;
  if (
    documentId === null ||
    result === undefined ||
    !cappedString(result.result, 128) ||
    result.result === ''
  ) {
    return null;
  }
  return {
    documentId,
    token: result.result,
  };
}

function injection(
  tabId: number,
  file: '/interaction-main.js' | '/interaction.js',
  world: 'ISOLATED' | 'MAIN',
): ScriptInjectionLike {
  return {
    target: { tabId, frameIds: [0] },
    files: [file],
    world,
    injectImmediately: true,
  };
}

function mainTeardownInjection(
  tabId: number,
  expectedToken: string,
): ScriptInjectionLike {
  return {
    target: { tabId, frameIds: [0] },
    func: teardownMainHistoryHook,
    args: [expectedToken],
    world: 'MAIN',
    injectImmediately: true,
  };
}

function cappedString(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length > maximum * 2) {
    return false;
  }
  let count = 0;
  for (const codePoint of value) {
    void codePoint;
    count += 1;
    if (count > maximum) {
      return false;
    }
  }
  return true;
}

function readElementDescriptor(value: unknown): ElementDescriptor | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['tag'], ['role', 'name', 'id', 'text']) ||
    !cappedString(value.tag, 32) ||
    !/^[a-z][a-z0-9-]*$/u.test(value.tag)
  ) {
    return undefined;
  }
  for (const key of ['role', 'name', 'id', 'text'] as const) {
    const field = value[key];
    if (
      field !== undefined &&
      (!cappedString(field, 80) ||
        field === '' ||
        field.replace(/\s+/gu, ' ').trim() !== field ||
        redactUnknown(field, DEFAULT_REDACTION_CONFIG) !== field ||
        field === REDACTED)
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    tag: value.tag,
    ...(value.role === undefined ? {} : { role: value.role as string }),
    ...(value.name === undefined ? {} : { name: value.name as string }),
    ...(value.id === undefined ? {} : { id: value.id as string }),
    ...(value.text === undefined ? {} : { text: value.text as string }),
  });
}

function readRawEvent(
  value: unknown,
  expectedOrigin: string,
): RawInteractionEvent | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['id', 'kind', 'occurredAt', 'trust'], ['target', 'url']) ||
    !cappedString(value.id, MAX_EVENT_ID_CODE_POINTS) ||
    value.id === '' ||
    typeof value.kind !== 'string' ||
    !['click', 'submit', 'navigation', 'history'].includes(value.kind) ||
    !Number.isFinite(value.occurredAt) ||
    typeof value.trust !== 'string' ||
    !['trusted', 'untrusted-hint'].includes(value.trust)
  ) {
    return null;
  }
  const kind = value.kind as InteractionEvent['kind'];
  const trust = value.trust as InteractionTrust;
  if (
    (trust === 'untrusted-hint' && kind !== 'history') ||
    (trust === 'trusted' && kind === 'history')
  ) {
    return null;
  }
  const target =
    value.target === undefined ? undefined : readElementDescriptor(value.target);
  if (
    (value.target !== undefined && target === undefined) ||
    ((kind === 'navigation' || kind === 'history') && target !== undefined)
  ) {
    return null;
  }
  let url: string | undefined;
  if (value.url !== undefined) {
    if (typeof value.url !== 'string') {
      return null;
    }
    url = sanitizePageUrl(value.url);
    if (url === undefined || url !== value.url || pageOrigin(url) !== expectedOrigin) {
      return null;
    }
  }
  return {
    id: value.id,
    kind,
    occurredAt: value.occurredAt as number,
    trust,
    ...(target === undefined ? {} : { target }),
    ...(url === undefined ? {} : { url }),
  };
}

function contentPortMatches(
  sender: RuntimeSenderLike | undefined,
  session: BackgroundSession,
  extensionId: string,
): sender is RuntimeSenderLike & {
  tab: { id: number };
  documentId: string;
} {
  try {
    if (
      sender === undefined ||
      sender.id !== extensionId ||
      sender.tab?.id !== session.tabId ||
      sender.frameId !== 0 ||
      typeof sender.documentId !== 'string' ||
      sender.documentId === '' ||
      sender.origin !== session.origin ||
      pageOrigin(sender.url) !== session.origin
    ) {
      return false;
    }
    const tabUrl = sender.tab.url;
    return tabUrl === undefined || pageOrigin(tabUrl) === session.origin;
  } catch {
    return false;
  }
}

function safePost(port: RuntimePortLike, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

function safeDisconnect(port: RuntimePortLike): void {
  try {
    port.disconnect();
  } catch {
    // A disappearing extension context is already disconnected.
  }
}

export function createBackgroundInteractionCoordinator(
  dependencies: BackgroundInteractionDependencies,
): BackgroundInteractionCoordinator {
  const sessions = new Map<number, BackgroundSession>();
  const startGenerations = new Map<number, number>();
  const teardownBarriers = new Map<number, Promise<void>>();
  let leaseSequence = 0;

  function nextLeaseId(tabId: number): string {
    leaseSequence += 1;
    let random = '';
    try {
      random = globalThis.crypto.randomUUID();
    } catch {
      random = `${Date.now()}-${leaseSequence}`;
    }
    return `${tabId}:${leaseSequence}:${random}`;
  }

  function boundedTeardown(operation: Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(fallback);
        resolve();
      };
      const fallback = globalThis.setTimeout(finish, MAIN_TEARDOWN_FALLBACK_MS);
      void operation.then(finish, finish);
    });
  }

  function directMainTeardown(tabId: number, expectedToken: string): void {
    let operation: Promise<void>;
    try {
      operation = Promise.resolve(
        dependencies.scripting.executeScript(
          mainTeardownInjection(tabId, expectedToken),
        ),
      ).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      // A navigated or closed page already retired its MAIN-world authority.
      operation = Promise.resolve();
    }
    const barrier = boundedTeardown(operation);
    teardownBarriers.set(tabId, barrier);
    void barrier.then(() => {
      if (teardownBarriers.get(tabId) === barrier) {
        teardownBarriers.delete(tabId);
      }
    });
  }

  async function waitForMainTeardown(tabId: number): Promise<void> {
    const barrier = teardownBarriers.get(tabId);
    if (barrier !== undefined) {
      await barrier;
    }
  }

  function retireSession(session: BackgroundSession): void {
    if (sessions.get(session.tabId) !== session) {
      return;
    }
    sessions.delete(session.tabId);
    session.active = false;
    const mainHookToken = session.mainHookToken;
    session.mainHookToken = null;
    const content = session.contentPort;
    session.contentPort = null;
    if (content !== null) {
      safePost(content, { type: 'payloadra:collector-stop' });
      safeDisconnect(content);
    }
    for (const lease of session.leases.values()) {
      if (lease.expiry !== null) {
        globalThis.clearTimeout(lease.expiry);
        lease.expiry = null;
      }
      if (lease.port !== null) {
        safeDisconnect(lease.port);
      }
    }
    session.leases.clear();
    if (mainHookToken !== null) {
      directMainTeardown(session.tabId, mainHookToken);
    }
  }

  function releaseLease(
    session: BackgroundSession,
    leaseId: string,
    expectedPort?: RuntimePortLike | null,
  ): void {
    if (sessions.get(session.tabId) !== session || !session.leases.has(leaseId)) {
      return;
    }
    const lease = session.leases.get(leaseId);
    if (lease === undefined) {
      return;
    }
    if (expectedPort !== undefined && lease.port !== expectedPort) {
      return;
    }
    session.leases.delete(leaseId);
    if (lease.expiry !== null) {
      globalThis.clearTimeout(lease.expiry);
      lease.expiry = null;
    }
    if (lease.port !== null) {
      safeDisconnect(lease.port);
    }
    if (session.leases.size === 0) {
      retireSession(session);
    }
  }

  function createSession(
    tabId: number,
    origin: string,
    leaseId: string,
  ): BackgroundSession {
    const session: BackgroundSession = {
      tabId,
      origin,
      documentId: null,
      active: false,
      mainHookToken: null,
      contentPort: null,
      leases: new Map([
        [
          leaseId,
          {
            port: null,
            expiry: null,
          },
        ],
      ]),
    };
    sessions.set(tabId, session);
    return session;
  }

  function scheduleUnclaimedLeaseExpiry(
    session: BackgroundSession,
    leaseId: string,
  ): void {
    const lease = session.leases.get(leaseId);
    if (
      sessions.get(session.tabId) !== session ||
      lease === undefined ||
      lease.port !== null ||
      lease.expiry !== null
    ) {
      return;
    }
    const expiry = globalThis.setTimeout(() => {
      const current = session.leases.get(leaseId);
      if (
        sessions.get(session.tabId) !== session ||
        current !== lease ||
        current.expiry !== expiry ||
        current.port !== null
      ) {
        return;
      }
      current.expiry = null;
      releaseLease(session, leaseId, null);
    }, UNCLAIMED_LEASE_TTL_MS);
    lease.expiry = expiry;
    try {
      if (
        typeof expiry === 'object' &&
        expiry !== null &&
        typeof (expiry as { unref?: unknown }).unref === 'function'
      ) {
        (expiry as { unref(): void }).unref();
      }
    } catch {
      // Browser timer handles are numbers; Node's unref is test-process hygiene.
    }
  }

  function acceptDevtoolsPort(
    port: RuntimePortLike,
    tabId: number,
    leaseId: string,
  ): boolean {
    let sender: RuntimeSenderLike;
    try {
      sender = port.sender ?? {};
    } catch {
      safeDisconnect(port);
      return false;
    }
    if (!isExtensionSender(sender, dependencies.extensionId)) {
      safeDisconnect(port);
      return false;
    }
    const session = sessions.get(tabId);
    if (session === undefined || !session.active) {
      safeDisconnect(port);
      return false;
    }
    const lease = session.leases.get(leaseId);
    if (lease === undefined || lease.port !== null) {
      safeDisconnect(port);
      return false;
    }
    if (lease.expiry !== null) {
      globalThis.clearTimeout(lease.expiry);
      lease.expiry = null;
    }
    lease.port = port;
    const onMessage = (message: unknown): void => {
      const safe = cloneInboundRecord(message);
      if (
        safe !== null &&
        hasExactKeys(safe, ['type']) &&
        safe.type === 'payloadra:stop' &&
        sessions.get(tabId) === session &&
        session.leases.get(leaseId)?.port === port
      ) {
        releaseLease(session, leaseId, port);
      }
    };
    const onDisconnect = (): void => {
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      releaseLease(session, leaseId, port);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    return true;
  }

  function configureContentPort(
    session: BackgroundSession,
    port: RuntimePortLike,
    documentId: string,
    expectedToken: string,
  ): void {
    if (
      sessions.get(session.tabId) !== session ||
      session.contentPort !== port ||
      session.documentId !== documentId ||
      !session.active ||
      session.mainHookToken !== expectedToken
    ) {
      return;
    }
    safePost(port, {
      type: 'payloadra:collector-config',
      mainHookToken: expectedToken,
    });
  }

  function acceptContentPort(port: RuntimePortLike): boolean {
    let sender: RuntimeSenderLike | undefined;
    try {
      sender = port.sender;
    } catch {
      safeDisconnect(port);
      return false;
    }
    const tabId = sender?.tab?.id;
    const session = tabId === undefined ? undefined : sessions.get(tabId);
    if (
      session === undefined ||
      !contentPortMatches(sender, session, dependencies.extensionId) ||
      (session.documentId !== null && session.documentId !== sender.documentId) ||
      session.contentPort !== null
    ) {
      safeDisconnect(port);
      return false;
    }
    const documentId = sender.documentId;
    session.documentId = documentId;
    session.contentPort = port;

    const onMessage = (message: unknown): void => {
      const safe = cloneInboundRecord(message);
      if (
        sessions.get(session.tabId) !== session ||
        session.contentPort !== port ||
        session.documentId !== documentId ||
        safe === null
      ) {
        return;
      }
      if (hasExactKeys(safe, ['type']) && safe.type === 'payloadra:content-ready') {
        const mainHookToken = session.mainHookToken;
        if (mainHookToken !== null) {
          configureContentPort(session, port, documentId, mainHookToken);
        }
        return;
      }
      if (
        !session.active ||
        !hasExactKeys(safe, ['type', 'event']) ||
        safe.type !== 'payloadra:interaction'
      ) {
        return;
      }
      const rawEvent = readRawEvent(safe.event, session.origin);
      if (rawEvent === null) {
        return;
      }
      const event: InteractionEvent = Object.freeze({
        ...rawEvent,
        tabId: String(session.tabId),
      });
      for (const lease of session.leases.values()) {
        if (lease.port !== null) {
          safePost(lease.port, { type: 'payloadra:interaction', event });
        }
      }
    };
    const onDisconnect = (): void => {
      if (
        sessions.get(session.tabId) === session &&
        session.contentPort === port &&
        session.documentId === documentId
      ) {
        session.contentPort = null;
      }
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    return true;
  }

  function handleStart(
    message: unknown,
    sender: RuntimeSenderLike,
  ): Promise<InteractionStartResult> {
    if (!isExtensionSender(sender, dependencies.extensionId)) {
      return Promise.resolve({
        status: 'network-only',
        reason: 'invalid-sender',
      });
    }
    const command = readStartCommand(message);
    if (command === null) {
      return Promise.resolve({
        status: 'network-only',
        reason: 'invalid-request',
      });
    }
    const generation = (startGenerations.get(command.tabId) ?? 0) + 1;
    startGenerations.set(command.tabId, generation);
    const permission = deriveOriginPermission(command.url);
    if (!permission.ok) {
      return Promise.resolve({
        status: 'network-only',
        reason: permission.reason,
      });
    }

    let permissionRequest: PromiseLike<boolean> | boolean;
    try {
      permissionRequest = dependencies.permissions.request({
        origins: [permission.pattern],
      });
    } catch {
      return Promise.resolve({
        status: 'network-only',
        reason: 'permission-error',
      });
    }

    return Promise.resolve(permissionRequest)
      .then(async (granted): Promise<InteractionStartResult> => {
        if (startGenerations.get(command.tabId) !== generation) {
          return {
            status: 'network-only',
            reason: 'superseded',
          };
        }
        if (!granted) {
          return {
            status: 'network-only',
            reason: 'permission-denied',
          };
        }

        let tab: Awaited<ReturnType<typeof dependencies.tabs.get>>;
        try {
          tab = await dependencies.tabs.get(command.tabId);
        } catch {
          return {
            status: 'network-only',
            reason: 'navigation-race',
          };
        }
        if (startGenerations.get(command.tabId) !== generation) {
          return {
            status: 'network-only',
            reason: 'superseded',
          };
        }
        if (
          (tab.id !== undefined && tab.id !== command.tabId) ||
          pageOrigin(tab.url) !== permission.origin
        ) {
          return {
            status: 'network-only',
            reason: 'navigation-race',
          };
        }

        const leaseId = nextLeaseId(command.tabId);
        let session = sessions.get(command.tabId);
        if (session !== undefined && session.origin !== permission.origin) {
          retireSession(session);
          session = undefined;
        }
        if (session === undefined) {
          session = createSession(command.tabId, permission.origin, leaseId);
        } else {
          session.leases.set(leaseId, {
            port: null,
            expiry: null,
          });
        }
        let mainAttempted = false;
        let installedMainToken: string | null = null;
        try {
          let isolatedDocument = readInjectionDocument(
            await dependencies.scripting.executeScript(
              injection(command.tabId, '/interaction.js', 'ISOLATED'),
            ),
          );
          if (
            startGenerations.get(command.tabId) !== generation ||
            sessions.get(command.tabId) !== session
          ) {
            releaseLease(session, leaseId);
            return {
              status: 'network-only',
              reason: 'superseded',
            };
          }
          if (isolatedDocument === null) {
            throw new Error('The collector injection was not authoritative.');
          }
          if (session.documentId !== null && session.documentId !== isolatedDocument) {
            retireSession(session);
            session = createSession(command.tabId, permission.origin, leaseId);
            isolatedDocument = readInjectionDocument(
              await dependencies.scripting.executeScript(
                injection(command.tabId, '/interaction.js', 'ISOLATED'),
              ),
            );
            if (
              isolatedDocument === null ||
              startGenerations.get(command.tabId) !== generation ||
              sessions.get(command.tabId) !== session
            ) {
              throw new Error('The inspected document changed during injection.');
            }
          }
          session.documentId = isolatedDocument;
          await waitForMainTeardown(command.tabId);
          if (
            startGenerations.get(command.tabId) !== generation ||
            sessions.get(command.tabId) !== session ||
            session.documentId !== isolatedDocument
          ) {
            throw new Error('The session changed during MAIN teardown.');
          }
          mainAttempted = true;
          const main = readMainInjection(
            await dependencies.scripting.executeScript(
              injection(command.tabId, '/interaction-main.js', 'MAIN'),
            ),
          );
          installedMainToken = main?.token ?? null;
          if (
            main === null ||
            main.documentId !== isolatedDocument ||
            session.documentId !== isolatedDocument ||
            sessions.get(command.tabId) !== session ||
            startGenerations.get(command.tabId) !== generation
          ) {
            throw new Error('The inspected document changed during injection.');
          }
          session.documentId = isolatedDocument;
          session.mainHookToken = main.token;
          session.active = true;
          if (session.contentPort !== null) {
            configureContentPort(
              session,
              session.contentPort,
              isolatedDocument,
              main.token,
            );
          }
          scheduleUnclaimedLeaseExpiry(session, leaseId);
          return {
            status: 'active',
            tabId: command.tabId,
            origin: permission.origin,
            documentId: isolatedDocument,
            leaseId,
          };
        } catch {
          const superseded = startGenerations.get(command.tabId) !== generation;
          if (installedMainToken !== null) {
            directMainTeardown(command.tabId, installedMainToken);
          }
          if (sessions.get(command.tabId) === session) {
            if (superseded) {
              releaseLease(session, leaseId);
            } else if (mainAttempted) {
              retireSession(session);
            } else {
              releaseLease(session, leaseId);
            }
          }
          return {
            status: 'network-only',
            reason: superseded ? 'superseded' : 'injection-failed',
          };
        }
      })
      .catch((): InteractionStartResult => ({
        status: 'network-only',
        reason: 'permission-error',
      }));
  }

  function handleRelease(message: unknown, sender: RuntimeSenderLike): Promise<void> {
    if (!isExtensionSender(sender, dependencies.extensionId)) {
      return Promise.resolve();
    }
    const command = readReleaseCommand(message);
    if (command === null) {
      return Promise.resolve();
    }
    const session = sessions.get(command.tabId);
    if (session !== undefined) {
      releaseLease(session, command.leaseId);
    }
    return Promise.resolve();
  }

  return {
    handleStart,
    handleRelease,

    acceptPort(port): boolean {
      if (port.name === CONTENT_PORT_NAME) {
        return acceptContentPort(port);
      }
      if (!port.name.startsWith(DEVTOOLS_PORT_PREFIX)) {
        safeDisconnect(port);
        return false;
      }
      const authority = port.name.slice(DEVTOOLS_PORT_PREFIX.length);
      const separator = authority.indexOf(':');
      if (separator < 1) {
        safeDisconnect(port);
        return false;
      }
      const tabText = authority.slice(0, separator);
      const leaseId = authority.slice(separator + 1);
      if (!/^(0|[1-9]\d*)$/u.test(tabText)) {
        safeDisconnect(port);
        return false;
      }
      const tabId = Number(tabText);
      if (!isTabId(tabId) || !cappedString(leaseId, 128) || leaseId === '') {
        safeDisconnect(port);
        return false;
      }
      return acceptDevtoolsPort(port, tabId, leaseId);
    },

    stopAll(): void {
      while (sessions.size > 0) {
        const session = sessions.values().next().value as BackgroundSession | undefined;
        if (session === undefined) {
          break;
        }
        retireSession(session);
      }
    },
  };
}

const UNAVAILABLE_REASONS = new Set<InteractionUnavailableReason>([
  'injection-failed',
  'invalid-request',
  'invalid-response',
  'invalid-sender',
  'navigation-race',
  'permission-denied',
  'permission-error',
  'restricted-page',
  'superseded',
]);

function readStartResult(value: unknown): InteractionStartResult {
  const safe = cloneInboundRecord(value);
  if (safe === null) {
    return { status: 'network-only', reason: 'invalid-response' };
  }
  if (
    hasExactKeys(safe, ['status', 'reason']) &&
    safe.status === 'network-only' &&
    typeof safe.reason === 'string' &&
    UNAVAILABLE_REASONS.has(safe.reason as InteractionUnavailableReason)
  ) {
    return {
      status: 'network-only',
      reason: safe.reason as InteractionUnavailableReason,
    };
  }
  if (
    hasExactKeys(safe, ['status', 'tabId', 'origin', 'documentId', 'leaseId']) &&
    safe.status === 'active' &&
    isTabId(safe.tabId) &&
    typeof safe.origin === 'string' &&
    deriveOriginPermission(safe.origin).ok &&
    typeof safe.documentId === 'string' &&
    safe.documentId !== '' &&
    cappedString(safe.leaseId, 128) &&
    safe.leaseId !== ''
  ) {
    return {
      status: 'active',
      tabId: safe.tabId,
      origin: safe.origin,
      documentId: safe.documentId,
      leaseId: safe.leaseId,
    };
  }
  return { status: 'network-only', reason: 'invalid-response' };
}

function readPanelEvent(
  value: unknown,
  tabId: number,
  origin: string,
): InteractionEvent | null {
  const safe = cloneInboundRecord(value);
  if (
    safe === null ||
    !hasExactKeys(
      safe,
      ['id', 'tabId', 'kind', 'occurredAt', 'trust'],
      ['target', 'url'],
    ) ||
    safe.tabId !== String(tabId)
  ) {
    return null;
  }
  const raw = { ...safe };
  Reflect.deleteProperty(raw, 'tabId');
  const event = readRawEvent(raw, origin);
  return event === null
    ? null
    : Object.freeze({
        ...event,
        tabId: String(tabId),
      });
}

export function createInteractionSource(runtime: PanelRuntimeLike): InteractionSource {
  const listeners = new Set<(event: InteractionEvent) => void>();
  type ActiveBinding = {
    readonly port: RuntimePortLike;
    readonly tabId: number;
    readonly leaseId: string;
  };
  let active: ActiveBinding | null = null;
  let generation = 0;
  const pending = new Set<Promise<InteractionStartResult>>();

  function closeActivePort(sendStop: boolean): void {
    const binding = active;
    if (binding === null) {
      return;
    }
    active = null;
    if (sendStop) {
      safePost(binding.port, { type: 'payloadra:stop' });
    }
    safeDisconnect(binding.port);
  }

  async function release(
    result: Extract<InteractionStartResult, { status: 'active' }>,
  ) {
    try {
      await Promise.resolve(
        runtime.sendMessage({
          type: 'payloadra:release-interactions',
          tabId: result.tabId,
          leaseId: result.leaseId,
        }),
      );
    } catch {
      // The background may already have retired the capability.
    }
  }

  return {
    start(context: InteractionStartContext): Promise<InteractionStartResult> {
      const startGeneration = ++generation;
      closeActivePort(true);
      let response: PromiseLike<unknown>;
      try {
        response = runtime.sendMessage({
          type: 'payloadra:start-interactions',
          tabId: context.tabId,
          url: context.url,
        });
      } catch {
        return Promise.resolve({
          status: 'network-only',
          reason: 'invalid-response',
        });
      }

      const operation = Promise.resolve(response)
        .then(async (value): Promise<InteractionStartResult> => {
          const result = readStartResult(value);
          if (generation !== startGeneration) {
            if (result.status === 'active') {
              await release(result);
            }
            return {
              status: 'network-only',
              reason: 'superseded',
            };
          }
          if (result.status === 'network-only') {
            return result;
          }
          const requestedOrigin = pageOrigin(context.url);
          if (
            result.tabId !== context.tabId ||
            requestedOrigin === null ||
            result.origin !== requestedOrigin
          ) {
            await release(result);
            return {
              status: 'network-only',
              reason: 'invalid-response',
            };
          }
          let port: RuntimePortLike;
          try {
            port = runtime.connect({
              name: `${DEVTOOLS_PORT_PREFIX}${result.tabId}:${result.leaseId}`,
            });
          } catch {
            await release(result);
            return {
              status: 'network-only',
              reason: 'invalid-response',
            };
          }
          if (generation !== startGeneration) {
            safeDisconnect(port);
            await release(result);
            return {
              status: 'network-only',
              reason: 'superseded',
            };
          }
          active = {
            port,
            tabId: result.tabId,
            leaseId: result.leaseId,
          };
          const onMessage = (message: unknown): void => {
            const safe = cloneInboundRecord(message);
            if (
              active?.port !== port ||
              safe === null ||
              !hasExactKeys(safe, ['type', 'event']) ||
              safe.type !== 'payloadra:interaction'
            ) {
              return;
            }
            const event = readPanelEvent(safe.event, result.tabId, result.origin);
            if (event === null) {
              return;
            }
            for (const listener of listeners) {
              try {
                listener(event);
              } catch {
                // A panel subscriber cannot break later interaction delivery.
              }
            }
          };
          const onDisconnect = (): void => {
            if (active?.port === port) {
              active = null;
            }
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
          };
          port.onMessage.addListener(onMessage);
          port.onDisconnect.addListener(onDisconnect);
          return result;
        })
        .catch((): InteractionStartResult =>
          generation === startGeneration
            ? {
                status: 'network-only',
                reason: 'invalid-response',
              }
            : {
                status: 'network-only',
                reason: 'superseded',
              },
        );
      pending.add(operation);
      void operation.finally(() => pending.delete(operation));
      return operation;
    },

    async stop(): Promise<void> {
      generation += 1;
      closeActivePort(true);
      await Promise.allSettled([...pending]);
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface CollectorDomEvent {
  readonly isTrusted?: boolean | undefined;
  readonly target?: unknown;
  readonly detail?: unknown;
  composedPath?(): readonly unknown[];
}

export interface CollectorEventHub {
  addEventListener(
    type: string,
    listener: (event: CollectorDomEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: CollectorDomEvent) => void,
    capture?: boolean,
  ): void;
  dispatchEvent(event: unknown): boolean;
}

export interface CollectorEnvironment {
  global: Record<string, unknown>;
  document: CollectorEventHub;
  window: CollectorEventHub;
  connect(): RuntimePortLike;
  currentUrl(): string;
  now(): number;
  nextId(): string;
  createSignal(type: string, detail?: unknown): unknown;
}

export type CollectorInstallation = Readonly<{
  status: 'already-installed' | 'installed' | 'unavailable';
  stop(): void;
}>;

function isForbiddenTextSubtree(candidate: {
  nodeType?: unknown;
  localName?: unknown;
  isContentEditable?: unknown;
  getAttribute?: unknown;
}): boolean {
  try {
    if (candidate.nodeType !== 1) {
      return false;
    }
    if (
      typeof candidate.localName !== 'string' ||
      candidate.localName.length > 64 ||
      TEXT_FORBIDDEN_SUBTREE_TAGS.has(candidate.localName.toLocaleLowerCase('en-US')) ||
      candidate.isContentEditable === true
    ) {
      return true;
    }
    if (typeof candidate.getAttribute !== 'function') {
      return false;
    }
    const editable = Reflect.apply(candidate.getAttribute, candidate, [
      'contenteditable',
    ]) as unknown;
    return (
      editable !== null &&
      (typeof editable !== 'string' || editable.toLocaleLowerCase('en-US') !== 'false')
    );
  } catch {
    return true;
  }
}

function boundedNodeText(value: unknown, maximum: number): string | null {
  const stack: unknown[] = [value];
  let visited = 0;
  let output = '';
  try {
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === null || typeof node !== 'object') {
        continue;
      }
      visited += 1;
      if (visited > MAX_TEXT_NODES) {
        return null;
      }
      const candidate = node as {
        nodeType?: unknown;
        nodeValue?: unknown;
        childNodes?: unknown;
        localName?: unknown;
        isContentEditable?: unknown;
        getAttribute?: unknown;
      };
      if (isForbiddenTextSubtree(candidate)) {
        continue;
      }
      if (candidate.nodeType === 3 || candidate.nodeType === 4) {
        if (typeof candidate.nodeValue !== 'string') {
          continue;
        }
        if (output.length + candidate.nodeValue.length > maximum) {
          return null;
        }
        output += candidate.nodeValue;
        continue;
      }
      const childNodes = candidate.childNodes;
      if (childNodes === null || typeof childNodes !== 'object') {
        continue;
      }
      const length = (childNodes as { length?: unknown }).length;
      if (
        !Number.isSafeInteger(length) ||
        (length as number) < 0 ||
        (length as number) > MAX_TEXT_NODES
      ) {
        return null;
      }
      for (let index = (length as number) - 1; index >= 0; index -= 1) {
        stack.push((childNodes as Record<number, unknown>)[index]);
      }
    }
  } catch {
    return null;
  }
  return output;
}

function toElementLike(value: unknown): ElementLike | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  try {
    const candidate = value as Partial<ElementLike>;
    const localName = candidate.localName;
    const getAttribute = candidate.getAttribute;
    const readText = candidate.readText;
    if (typeof localName !== 'string' || typeof getAttribute !== 'function') {
      return null;
    }
    return {
      localName,
      getAttribute: (name) =>
        Reflect.apply(getAttribute, value, [name]) as string | null,
      readText:
        typeof readText === 'function'
          ? (maximum) => Reflect.apply(readText, value, [maximum]) as string | null
          : (maximum) => boundedNodeText(value, maximum),
    };
  } catch {
    return null;
  }
}

function eventTarget(event: CollectorDomEvent): ElementLike | null {
  let path: readonly unknown[];
  try {
    path = event.composedPath?.() ?? [];
  } catch {
    return null;
  }
  if (!Array.isArray(path)) {
    return null;
  }
  const length = Math.min(path.length, MAX_EVENT_PATH);
  for (let index = 0; index < length; index += 1) {
    const candidate = path[index];
    const element = toElementLike(candidate);
    if (element !== null) {
      return element;
    }
  }
  return null;
}

function currentSafeUrl(environment: CollectorEnvironment): string | undefined {
  try {
    return sanitizePageUrl(environment.currentUrl());
  } catch {
    return undefined;
  }
}

export function installInteractionCollector(
  environment: CollectorEnvironment,
): CollectorInstallation {
  const existing = environment.global[COLLECTOR_GUARD];
  if (
    existing !== null &&
    typeof existing === 'object' &&
    typeof (existing as { stop?: unknown }).stop === 'function'
  ) {
    return {
      status: 'already-installed',
      stop: (existing as { stop(): void }).stop,
    };
  }

  let port: RuntimePortLike;
  try {
    port = environment.connect();
  } catch {
    return { status: 'unavailable', stop: () => undefined };
  }
  let stopped = false;
  let mainHookToken: string | null = null;

  function emit(
    kind: InteractionEvent['kind'],
    trust: InteractionTrust,
    target?: ElementDescriptor,
  ): void {
    let id: string;
    let occurredAt: number;
    try {
      id = environment.nextId();
      occurredAt = environment.now();
    } catch {
      return;
    }
    if (
      !cappedString(id, MAX_EVENT_ID_CODE_POINTS) ||
      id === '' ||
      !Number.isFinite(occurredAt)
    ) {
      return;
    }
    const url = currentSafeUrl(environment);
    safePost(port, {
      type: 'payloadra:interaction',
      event: {
        id,
        kind,
        occurredAt,
        trust,
        ...(target === undefined ? {} : { target }),
        ...(url === undefined ? {} : { url }),
      },
    });
  }

  const onClick = (event: CollectorDomEvent): void => {
    if (event.isTrusted !== true) {
      return;
    }
    const target = eventTarget(event);
    emit('click', 'trusted', target === null ? undefined : describeElement(target));
  };
  const onSubmit = (event: CollectorDomEvent): void => {
    if (event.isTrusted !== true) {
      return;
    }
    const target = toElementLike(event.target);
    if (target === null) {
      return;
    }
    emit('submit', 'trusted', describeSubmit(target));
  };
  const onNavigation = (event: CollectorDomEvent): void => {
    if (event.isTrusted === true) {
      emit('navigation', 'trusted');
    }
  };
  const onHistory = (): void => {
    emit('history', 'untrusted-hint');
  };

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    environment.document.removeEventListener('click', onClick, true);
    environment.document.removeEventListener('submit', onSubmit, true);
    environment.window.removeEventListener('popstate', onNavigation, true);
    environment.window.removeEventListener('hashchange', onNavigation, true);
    environment.window.removeEventListener(HISTORY_SIGNAL, onHistory, true);
    const teardownToken = mainHookToken;
    mainHookToken = null;
    if (teardownToken !== null) {
      try {
        environment.window.dispatchEvent(
          environment.createSignal(HISTORY_TEARDOWN_SIGNAL, {
            token: teardownToken,
          }),
        );
      } catch {
        // MAIN-world teardown is best effort and carries no page evidence.
      }
    }
    safeDisconnect(port);
    if (environment.global[COLLECTOR_GUARD] === installation) {
      Reflect.deleteProperty(environment.global, COLLECTOR_GUARD);
    }
  }

  const onPortMessage = (message: unknown): void => {
    if (stopped) {
      return;
    }
    const safe = cloneInboundRecord(message);
    if (
      safe !== null &&
      hasExactKeys(safe, ['type', 'mainHookToken']) &&
      safe.type === 'payloadra:collector-config' &&
      cappedString(safe.mainHookToken, 128) &&
      safe.mainHookToken !== ''
    ) {
      mainHookToken = safe.mainHookToken;
      return;
    }
    if (
      safe !== null &&
      hasExactKeys(safe, ['type']) &&
      safe.type === 'payloadra:collector-stop'
    ) {
      stop();
    }
  };
  const onPortDisconnect = (): void => stop();
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(onPortDisconnect);

  const installation: CollectorInstallation = Object.freeze({
    status: 'installed',
    stop,
  });
  environment.global[COLLECTOR_GUARD] = installation;
  environment.document.addEventListener('click', onClick, true);
  environment.document.addEventListener('submit', onSubmit, true);
  environment.window.addEventListener('popstate', onNavigation, true);
  environment.window.addEventListener('hashchange', onNavigation, true);
  environment.window.addEventListener(HISTORY_SIGNAL, onHistory, true);
  safePost(port, { type: 'payloadra:content-ready' });
  return installation;
}

export interface MainHistoryEnvironment {
  readonly global: Record<string, unknown>;
  readonly history: {
    pushState: CallableFunction;
    replaceState: CallableFunction;
  };
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
  dispatchSignal(type: string, detail?: unknown): void;
}

export type MainHistoryInstallation = Readonly<{
  status: 'already-installed' | 'installed' | 'unavailable';
  token: string;
  stop(): void;
}>;

function nextMainHookToken(): string {
  mainHookSequence += 1;
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}:${mainHookSequence}`;
  }
}

function readMainInstallation(
  global: Record<string, unknown>,
): MainHistoryInstallation | null {
  try {
    const guard = Object.getOwnPropertyDescriptor(global, HISTORY_GUARD);
    if (guard === undefined || !('value' in guard)) {
      return null;
    }
    const value = guard.value;
    if (value === null || typeof value !== 'object') {
      return null;
    }
    const token = Object.getOwnPropertyDescriptor(value, 'token');
    const stop = Object.getOwnPropertyDescriptor(value, 'stop');
    return token !== undefined &&
      'value' in token &&
      cappedString(token.value, 128) &&
      token.value !== '' &&
      stop !== undefined &&
      'value' in stop &&
      typeof stop.value === 'function'
      ? (value as MainHistoryInstallation)
      : null;
  } catch {
    return null;
  }
}

function unavailableMainInstallation(): MainHistoryInstallation {
  return Object.freeze({
    status: 'unavailable',
    token: '',
    stop: () => undefined,
  });
}

export function teardownMainHistoryHook(
  expectedToken: string,
  target?: Record<string, unknown>,
): void {
  try {
    const global = target ?? (globalThis as unknown as Record<string, unknown>);
    const guard = Object.getOwnPropertyDescriptor(global, '__payloadraHistoryHookV1');
    if (
      guard === undefined ||
      !('value' in guard) ||
      guard.value === null ||
      typeof guard.value !== 'object'
    ) {
      return;
    }
    const token = Object.getOwnPropertyDescriptor(guard.value, 'token');
    const stop = Object.getOwnPropertyDescriptor(guard.value, 'stop');
    if (
      token === undefined ||
      !('value' in token) ||
      token.value !== expectedToken ||
      stop === undefined ||
      !('value' in stop) ||
      typeof stop.value !== 'function'
    ) {
      return;
    }
    Reflect.apply(stop.value, guard.value, []);
  } catch {
    // Direct teardown is deliberately idempotent and best effort.
  }
}

export function installMainHistoryHook(
  environment: MainHistoryEnvironment,
  replaceExisting = false,
): MainHistoryInstallation {
  const existing = readMainInstallation(environment.global);
  if (existing !== null) {
    if (!replaceExisting) {
      return {
        status: 'already-installed',
        token: existing.token,
        stop: existing.stop,
      };
    }
    try {
      existing.stop();
    } catch {
      return unavailableMainInstallation();
    }
    if (readMainInstallation(environment.global) !== null) {
      return unavailableMainInstallation();
    }
  }
  let originalPush: CallableFunction;
  let originalReplace: CallableFunction;
  try {
    originalPush = environment.history.pushState;
    originalReplace = environment.history.replaceState;
  } catch {
    return unavailableMainInstallation();
  }
  if (typeof originalPush !== 'function' || typeof originalReplace !== 'function') {
    return unavailableMainInstallation();
  }
  let stopped = false;
  let listenerInstalled = false;
  const token = nextMainHookToken();

  const wrappedPush = function (this: unknown, ...args: unknown[]): unknown {
    const result = Reflect.apply(originalPush, this, args);
    try {
      environment.dispatchSignal(HISTORY_SIGNAL);
    } catch {
      // Telemetry cannot alter native history semantics.
    }
    return result;
  };
  const wrappedReplace = function (this: unknown, ...args: unknown[]): unknown {
    const result = Reflect.apply(originalReplace, this, args);
    try {
      environment.dispatchSignal(HISTORY_SIGNAL);
    } catch {
      // Telemetry cannot alter native history semantics.
    }
    return result;
  };

  const onTeardown = (event?: unknown): void => {
    try {
      if (event === null || typeof event !== 'object') {
        return;
      }
      const detail = (event as { detail?: unknown }).detail;
      if (
        detail === null ||
        typeof detail !== 'object' ||
        (detail as { token?: unknown }).token !== token
      ) {
        return;
      }
      stop();
    } catch {
      // Malformed page events cannot tear down current hook authority.
    }
  };

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      if (environment.history.pushState === wrappedPush) {
        environment.history.pushState = originalPush;
      }
    } catch {
      // Restore only writable methods still owned by this hook.
    }
    try {
      if (environment.history.replaceState === wrappedReplace) {
        environment.history.replaceState = originalReplace;
      }
    } catch {
      // Restore only writable methods still owned by this hook.
    }
    if (listenerInstalled) {
      try {
        environment.removeEventListener(HISTORY_TEARDOWN_SIGNAL, onTeardown);
      } catch {
        // A disappearing page cannot retain executable extension authority.
      }
      listenerInstalled = false;
    }
    try {
      const guard = Object.getOwnPropertyDescriptor(environment.global, HISTORY_GUARD);
      if (guard !== undefined && 'value' in guard && guard.value === installation) {
        Reflect.deleteProperty(environment.global, HISTORY_GUARD);
      }
    } catch {
      // Guard cleanup is best effort after owned methods are restored.
    }
  }

  const installation: MainHistoryInstallation = Object.freeze({
    status: 'installed',
    token,
    stop,
  });
  try {
    environment.history.pushState = wrappedPush;
    if (environment.history.pushState !== wrappedPush) {
      throw new Error('pushState patch was rejected.');
    }
    environment.history.replaceState = wrappedReplace;
    if (environment.history.replaceState !== wrappedReplace) {
      throw new Error('replaceState patch was rejected.');
    }
    listenerInstalled = true;
    environment.addEventListener(HISTORY_TEARDOWN_SIGNAL, onTeardown);
    Object.defineProperty(environment.global, HISTORY_GUARD, {
      value: installation,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    if (readMainInstallation(environment.global) !== installation) {
      throw new Error('history hook guard was rejected.');
    }
    return installation;
  } catch {
    stop();
    return unavailableMainInstallation();
  }
}
