import {
  createBackgroundInteractionCoordinator,
  type RuntimePortLike,
  type RuntimeSenderLike,
} from '../src/infrastructure/chrome/interaction-bridge';
import {
  createPanelFocusCoordinator,
  PANEL_FOCUS_REQUEST_MESSAGE,
  PANEL_FOCUS_STATUS_MESSAGE,
  type PanelFocusOutcome,
  type PanelFocusStatus,
} from '../src/infrastructure/chrome/panel-focus';

export default defineBackground(() => {
  const panelFocus = createPanelFocusCoordinator({ extensionId: chrome.runtime.id });
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
    if (type === PANEL_FOCUS_STATUS_MESSAGE || type === PANEL_FOCUS_REQUEST_MESSAGE) {
      const answer: PanelFocusStatus | PanelFocusOutcome | null =
        panelFocus.handleMessage(message, sender as RuntimeSenderLike);
      if (answer !== null) {
        sendResponse(answer);
      }
      return undefined;
    }
    if (
      type !== 'exhibit:start-interactions' &&
      type !== 'exhibit:release-interactions'
    ) {
      return undefined;
    }
    if (type === 'exhibit:release-interactions') {
      void coordinator.handleRelease(message, sender as RuntimeSenderLike);
      return undefined;
    }
    void coordinator
      .handleStart(message, sender as RuntimeSenderLike)
      .then(sendResponse);
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    const candidate = port as unknown as RuntimePortLike;
    // The interaction coordinator disconnects any port it does not recognise,
    // so the focus channel has to claim its own ports before delegating.
    if (panelFocus.acceptPort(candidate)) return;
    coordinator.acceptPort(candidate);
  });
});
