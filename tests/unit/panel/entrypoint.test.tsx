// @vitest-environment jsdom

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThemeName = 'dark' | 'default';

function installChrome(
  inspected: unknown,
  themeName: ThemeName = 'default',
  storedSettings?: unknown,
): {
  emitTheme(theme: ThemeName): void;
  localSet: ReturnType<typeof vi.fn>;
  localSetAccessLevel: ReturnType<typeof vi.fn>;
} {
  let themeHandler: ((theme: ThemeName) => void) | undefined;
  const localSet = vi.fn(async () => undefined);
  const localSetAccessLevel = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    devtools: {
      inspectedWindow: {
        tabId: 9,
        eval: (_expression: string, callback: (result: unknown) => void) => {
          callback(inspected);
        },
      },
      network: {
        onRequestFinished: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        getHAR: vi.fn(),
      },
      panels: {
        themeName,
        setThemeChangeHandler(callback?: (theme: ThemeName) => void) {
          themeHandler = callback;
        },
      },
    },
    runtime: {},
    storage: {
      session: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      local: {
        get: async (key: string) =>
          storedSettings === undefined ? {} : { [key]: storedSettings },
        set: localSet,
        setAccessLevel: localSetAccessLevel,
      },
    },
  });
  return {
    emitTheme(theme) {
      themeHandler?.(theme);
    },
    localSet,
    localSetAccessLevel,
  };
}

async function bootEntrypoint(): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import('../../../entrypoints/panel/main');
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('panel production entrypoint', () => {
  it.each([
    ['chrome', { href: 'chrome://settings/privacy', origin: 'chrome://settings' }],
    ['edge', { href: 'edge://settings/privacy', origin: 'edge://settings' }],
    ['about', { href: 'about:blank', origin: 'null' }],
  ])(
    'maps a real %s page to a safe restricted state without rendering its raw URL',
    async (_scheme, inspected) => {
      installChrome(inspected);

      await bootEntrypoint();

      expect(await screen.findByText('This page is restricted')).toBeVisible();
      expect(screen.getByText('Restricted browser page')).toBeVisible();
      expect(screen.queryByText(inspected.href)).not.toBeInTheDocument();
    },
  );

  it('resolves and live-updates the selected DevTools theme from the supported API', async () => {
    const user = userEvent.setup();
    const chromeApi = installChrome(
      { href: 'https://app.test/orders', origin: 'https://app.test' },
      'default',
    );

    await bootEntrypoint();
    await user.selectOptions(await screen.findByLabelText('Theme'), 'devtools');

    const shell = document.querySelector('.app-shell');
    expect(shell).toHaveAttribute('data-devtools-theme', 'light');

    act(() => chromeApi.emitTheme('dark'));
    expect(shell).toHaveAttribute('data-devtools-theme', 'dark');
  });

  it('loads local privacy settings before render and persists theme changes', async () => {
    const user = userEvent.setup();
    const chromeApi = installChrome(
      { href: 'https://app.test/orders', origin: 'https://app.test' },
      'default',
      {
        version: 1,
        theme: 'dark',
        customFieldNames: ['Private Note'],
      },
    );

    await bootEntrypoint();
    const settingsButton = await screen.findByRole('button', {
      name: 'Privacy settings',
    });

    const shell = document.querySelector('.app-shell');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    await user.click(settingsButton);
    expect(
      screen.getByRole('textbox', { name: 'Additional sensitive field names' }),
    ).toHaveValue('Private Note');
    await user.keyboard('{Escape}');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');

    expect(chromeApi.localSet).toHaveBeenCalledWith({
      'payloadra:settings:v1': {
        version: 1,
        theme: 'light',
        customFieldNames: ['Private Note'],
      },
    });
    expect(chromeApi.localSetAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });
});

describe('panel boot failures', () => {
  it('falls back to the unknown-origin state when the page eval never calls back', async () => {
    vi.stubGlobal('chrome', {
      devtools: {
        inspectedWindow: { tabId: 9, eval: () => undefined },
        network: {
          onRequestFinished: { addListener: vi.fn(), removeListener: vi.fn() },
          getHAR: vi.fn(),
        },
        panels: { themeName: 'default', setThemeChangeHandler: vi.fn() },
      },
      runtime: {},
      storage: {
        session: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    });

    await bootEntrypoint();

    expect(
      await screen.findByText('Inspected page', {}, { timeout: 4_000 }),
    ).toBeVisible();
  }, 10_000);

  it('explains a failed boot instead of leaving the panel blank', async () => {
    vi.stubGlobal('chrome', {
      devtools: {
        inspectedWindow: {
          tabId: 9,
          eval: () => {
            throw new Error('devtools eval unavailable for https://app.test/secret');
          },
        },
        panels: { themeName: 'default', setThemeChangeHandler: vi.fn() },
      },
      runtime: {},
      storage: {
        session: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
    });

    await bootEntrypoint();

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'Payloadra could not start in this DevTools window.',
    );
    expect(document.body.textContent).not.toContain('secret');
  });
});
