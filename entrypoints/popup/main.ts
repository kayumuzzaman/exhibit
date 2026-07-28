import {
  PANEL_FOCUS_REQUEST_MESSAGE,
  PANEL_FOCUS_STATUS_MESSAGE,
} from '../../src/infrastructure/chrome/panel-focus';
import '../../src/styles/tokens.css';
import '../../src/styles/reset.css';
import '../../src/styles/popup.css';

const CLOSED_NOTE =
  'DevTools is not open on this tab yet, so follow the steps above first.';
const READY_NOTE = 'DevTools is open on this tab.';
const FAILED_NOTE = 'DevTools closed before the panel could be shown.';

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** The popup only ever needs the tab identity, never its address. */
async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : null;
  } catch {
    return null;
  }
}

async function ask(type: string, tabId: number): Promise<Record<string, unknown>> {
  try {
    const answer: unknown = await chrome.runtime.sendMessage({ type, tabId });
    return answer !== null && typeof answer === 'object'
      ? (answer as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function start(): Promise<void> {
  const status = element('status');
  const button = element<HTMLButtonElement>('focus');
  if (status === null || button === null) return;

  const tabId = await activeTabId();
  if (tabId === null) {
    status.textContent = CLOSED_NOTE;
    return;
  }

  const { available } = await ask(PANEL_FOCUS_STATUS_MESSAGE, tabId);
  if (available !== true) {
    status.textContent = CLOSED_NOTE;
    return;
  }

  status.textContent = READY_NOTE;
  button.hidden = false;
  button.addEventListener('click', () => {
    button.disabled = true;
    void ask(PANEL_FOCUS_REQUEST_MESSAGE, tabId).then((answer) => {
      if (answer.status === 'focused') {
        window.close();
        return;
      }
      button.hidden = true;
      status.textContent = FAILED_NOTE;
    });
  });
}

void start();
