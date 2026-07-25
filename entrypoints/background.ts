import {
  createBackgroundInteractionCoordinator,
  type RuntimePortLike,
  type RuntimeSenderLike,
} from '../src/infrastructure/chrome/interaction-bridge';

export default defineBackground(() => {
  const coordinator = createBackgroundInteractionCoordinator({
    extensionId: chrome.runtime.id,
    permissions: chrome.permissions,
    tabs: chrome.tabs,
    scripting: {
      executeScript: (injection) => {
        const target = {
          tabId: injection.target.tabId,
          frameIds: [...injection.target.frameIds],
        };
        if (injection.files !== undefined) {
          return chrome.scripting.executeScript({
            target,
            files: [...injection.files],
            world: injection.world,
            injectImmediately: injection.injectImmediately,
          });
        }
        return chrome.scripting.executeScript({
          target,
          func: injection.func,
          args: [...injection.args],
          world: injection.world,
          injectImmediately: injection.injectImmediately,
        });
      },
    },
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let type: unknown;
    try {
      const descriptor =
        message !== null && typeof message === 'object'
          ? Object.getOwnPropertyDescriptor(message, 'type')
          : undefined;
      type =
        descriptor !== undefined && 'value' in descriptor
          ? descriptor.value
          : undefined;
    } catch {
      return undefined;
    }
    if (
      type !== 'payloadra:start-interactions' &&
      type !== 'payloadra:release-interactions'
    ) {
      return undefined;
    }
    if (type === 'payloadra:release-interactions') {
      void coordinator.handleRelease(message, sender as RuntimeSenderLike);
      return undefined;
    }
    void coordinator
      .handleStart(message, sender as RuntimeSenderLike)
      .then(sendResponse);
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    coordinator.acceptPort(port as unknown as RuntimePortLike);
  });
});
