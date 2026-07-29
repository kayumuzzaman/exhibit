import type { InteractionEvent } from '../../src/domain/model';
import {
  installInteractionCollector,
  type CollectorEventHub,
  type CollectorInstallation,
  type RuntimePortLike,
} from '../../src/infrastructure/chrome/interaction-bridge';
import type { InteractionSource } from '../../src/ports/interaction-source';

export type LoopbackInteractionSource = InteractionSource &
  Readonly<{
    /**
     * Installs the collector in an additional same-origin document, such as a
     * fixture page loaded in a frame, and returns a detach function.
     */
    attach(frame: Window & typeof globalThis): () => void;
  }>;

function readInteraction(message: unknown): InteractionEvent | null {
  if (message === null || typeof message !== 'object') return null;
  const envelope = message as { type?: unknown; event?: unknown };
  if (envelope.type !== 'exhibit:interaction') return null;
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
export function createLoopbackInteractionSource(): LoopbackInteractionSource {
  const listeners = new Set<(event: InteractionEvent) => void>();
  const frames = new Map<Window & typeof globalThis, CollectorInstallation>();
  let installation: CollectorInstallation | null = null;
  let boundTabId: string | null = null;

  const port: RuntimePortLike = {
    name: 'exhibit:content',
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

  function install(view: Window & typeof globalThis): CollectorInstallation {
    return installInteractionCollector({
      global: view as unknown as Record<string, unknown>,
      document: view.document as unknown as CollectorEventHub,
      window: view as unknown as CollectorEventHub,
      connect: () => port,
      currentUrl: () => view.location.href,
      now: Date.now,
      nextId: () => crypto.randomUUID(),
      createSignal: (type, detail) => new view.CustomEvent(type, { detail }),
    });
  }

  function releaseFrames(): void {
    for (const [, frameInstallation] of frames) {
      try {
        frameInstallation.stop();
      } catch {
        // A navigated or closed frame no longer needs teardown.
      }
    }
    frames.clear();
  }

  return {
    async start(context) {
      installation?.stop();
      installation = install(globalThis as unknown as Window & typeof globalThis);
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
      releaseFrames();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attach(frame) {
      frames.get(frame)?.stop();
      frames.set(frame, install(frame));
      return () => {
        frames.get(frame)?.stop();
        frames.delete(frame);
      };
    },
  };
}
