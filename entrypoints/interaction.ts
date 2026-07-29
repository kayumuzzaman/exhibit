import {
  installInteractionCollector,
  type CollectorEventHub,
  type RuntimePortLike,
} from '../src/infrastructure/chrome/interaction-bridge';

export default defineUnlistedScript(() => {
  installInteractionCollector({
    global: globalThis as unknown as Record<string, unknown>,
    document: document as unknown as CollectorEventHub,
    window: window as unknown as CollectorEventHub,
    connect: () =>
      chrome.runtime.connect({
        name: 'exhibit:content',
      }) as unknown as RuntimePortLike,
    currentUrl: () => location.href,
    now: Date.now,
    nextId: () => crypto.randomUUID(),
    createSignal: (type, detail) => new CustomEvent(type, { detail }),
  });
});
