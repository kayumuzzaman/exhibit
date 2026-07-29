// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PANEL_FOCUS_REQUEST_MESSAGE,
  PANEL_FOCUS_STATUS_MESSAGE,
} from '../../../src/infrastructure/chrome/panel-focus';

type Answer = Record<string, unknown>;

/** jsdom gives `import.meta.url` an http scheme, so resolve from the repo root. */
async function popupMarkup(): Promise<string> {
  const html = await readFile('entrypoints/popup.html', 'utf8');
  return /<body[^>]*>([\s\S]*)<\/body>/iu.exec(html)?.[1] ?? '';
}

function installChrome(options: {
  tabId?: number | undefined;
  answers?: Partial<Record<string, Answer>>;
  queryError?: boolean;
}): { sent: unknown[] } {
  const sent: unknown[] = [];
  vi.stubGlobal('chrome', {
    tabs: {
      query: async () => {
        if (options.queryError === true) throw new Error('no tabs access');
        return options.tabId === undefined ? [{}] : [{ id: options.tabId }];
      },
    },
    runtime: {
      sendMessage: async (message: { type: string }) => {
        sent.push(message);
        return options.answers?.[message.type] ?? {};
      },
    },
  });
  return { sent };
}

async function boot(): Promise<void> {
  document.body.innerHTML = await popupMarkup();
  vi.resetModules();
  await import('../../../entrypoints/popup/main');
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  vi.stubGlobal('close', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('toolbar popup', () => {
  it('explains where the panel lives before any script runs', async () => {
    const markup = await popupMarkup();

    expect(markup).toContain('Exhibit is a DevTools panel');
    expect(markup).toContain('Exhibit');
  });

  it('offers to show the panel when DevTools is open on the active tab', async () => {
    const { sent } = installChrome({
      tabId: 4,
      answers: {
        [PANEL_FOCUS_STATUS_MESSAGE]: { available: true },
        [PANEL_FOCUS_REQUEST_MESSAGE]: { status: 'focused' },
      },
    });

    await boot();
    const button = document.getElementById('focus') as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(document.getElementById('status')?.textContent).toContain(
      'DevTools is open',
    );

    button.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(sent).toEqual([
      { type: PANEL_FOCUS_STATUS_MESSAGE, tabId: 4 },
      { type: PANEL_FOCUS_REQUEST_MESSAGE, tabId: 4 },
    ]);
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the button hidden when DevTools is not open', async () => {
    installChrome({
      tabId: 4,
      answers: { [PANEL_FOCUS_STATUS_MESSAGE]: { available: false } },
    });

    await boot();

    expect((document.getElementById('focus') as HTMLButtonElement).hidden).toBe(true);
    expect(document.getElementById('status')?.textContent).toContain('not open');
  });

  it('reports a window that closed between the check and the click', async () => {
    installChrome({
      tabId: 4,
      answers: {
        [PANEL_FOCUS_STATUS_MESSAGE]: { available: true },
        [PANEL_FOCUS_REQUEST_MESSAGE]: { status: 'devtools-closed' },
      },
    });

    await boot();
    (document.getElementById('focus') as HTMLButtonElement).click();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(document.getElementById('status')?.textContent).toContain(
      'closed before the panel',
    );
    expect(window.close).not.toHaveBeenCalled();
  });

  it.each([
    ['a tab with no identifier', { tabId: undefined }],
    ['a refused tab query', { queryError: true }],
  ])('falls back to the instructions for %s', async (_label, options) => {
    installChrome(options);

    await boot();

    expect((document.getElementById('focus') as HTMLButtonElement).hidden).toBe(true);
    expect(document.getElementById('status')?.textContent).toContain('not open');
  });
});
