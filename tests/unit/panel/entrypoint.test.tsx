// @vitest-environment jsdom

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ThemeName = 'dark' | 'default';

function installChrome(
  inspected: unknown,
  themeName: ThemeName = 'default',
): {
  emitTheme(theme: ThemeName): void;
} {
  let themeHandler: ((theme: ThemeName) => void) | undefined;
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
  });
  return {
    emitTheme(theme) {
      themeHandler?.(theme);
    },
  };
}

async function bootEntrypoint(): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import('../../../entrypoints/panel/main');
}

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
});
