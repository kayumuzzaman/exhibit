import type { InteractionEvent } from '../../src/domain/model';
import {
  installInteractionCollector,
  type CollectorEventHub,
  type CollectorInstallation,
  type RuntimePortLike,
} from '../../src/infrastructure/chrome/interaction-bridge';
import type { InteractionSource } from '../../src/ports/interaction-source';

function readInteraction(message: unknown): InteractionEvent | null {
  if (message === null || typeof message !== 'object') return null;
  const envelope = message as { type?: unknown; event?: unknown };
  if (envelope.type !== 'payloadra:interaction') return null;
  const event = envelope.event;
  if (event === null || typeof event !== 'object') return null;
  const candidate = event as Partial<InteractionEvent>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.occurredAt !== 'number' ||
    typeof candidate.trust !== 'string'
  ) {
    return null;
  }
  return candidate as InteractionEvent;
}

/**
 * Runs the production interaction collector against the harness document and
 * routes its port messages straight back to the recording pipeline, replacing
 * only the extension messaging hop that end-to-end pages cannot provide.
 */
export function createLoopbackInteractionSource(): InteractionSource {
  const listeners = new Set<(event: InteractionEvent) => void>();
  let installation: CollectorInstallation | null = null;
  let boundTabId: string | null = null;

  const port: RuntimePortLike = {
    name: 'payloadra:content',
    onMessage: { addListener() {}, removeListener() {} },
    onDisconnect: { addListener() {}, removeListener() {} },
    postMessage(message) {
      const event = readInteraction(message);
      if (event === null || boundTabId === null) return;
      // The panel stamps the owning tab before events reach the session.
      const stamped: InteractionEvent = { ...event, tabId: boundTabId };
      // The extension messaging hop is asynchronous; delivering synchronously
      // would re-render React inside the page's own click dispatch.
      setTimeout(() => {
        for (const listener of listeners) listener(stamped);
      }, 0);
    },
    disconnect() {},
  };

  return {
    async start(context) {
      installation?.stop();
      installation = installInteractionCollector({
        global: globalThis as unknown as Record<string, unknown>,
        document: document as unknown as CollectorEventHub,
        window: window as unknown as CollectorEventHub,
        connect: () => port,
        currentUrl: () => location.href,
        now: Date.now,
        nextId: () => crypto.randomUUID(),
        createSignal: (type, detail) => new CustomEvent(type, { detail }),
      });
      if (installation.status === 'unavailable') {
        return { status: 'network-only', reason: 'injection-failed' };
      }
      let origin: string;
      try {
        origin = new URL(context.url).origin;
      } catch {
        return { status: 'network-only', reason: 'restricted-page' };
      }
      boundTabId = String(context.tabId);
      return {
        status: 'active',
        tabId: context.tabId,
        origin,
        documentId: 'harness-document',
        leaseId: 'harness-lease',
      };
    },
    async stop() {
      installation?.stop();
      installation = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
