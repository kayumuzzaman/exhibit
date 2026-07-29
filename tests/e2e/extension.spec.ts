import { expect, test } from 'playwright/test';

import { buildManifest } from '../../wxt.config';
import { withExtension } from './extension.fixture';

/**
 * Playwright cannot drive the Chrome DevTools window, so the panel workspace is
 * covered by the harness specs. These tests exercise the parts of the shipped
 * MV3 package that only a real browser can run: the packed manifest, the
 * background service worker, and its message boundary.
 */
test.describe('packaged extension', () => {
  test('registers an MV3 service worker with the declared surface', async () => {
    await withExtension(async ({ context, extensionId }) => {
      expect(extensionId).toMatch(/^[a-p]{32}$/u);
      expect(context.serviceWorkers()).toHaveLength(1);

      const manifest = await context
        .serviceWorkers()[0]!
        .evaluate(() => chrome.runtime.getManifest());
      const declared = buildManifest();

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe(declared.name);
      expect(manifest.permissions).toEqual(declared.permissions);
      expect(manifest.optional_host_permissions).toEqual(
        declared.optional_host_permissions,
      );
      expect(manifest.host_permissions ?? []).toEqual([]);
      expect(manifest.devtools_page).toBe(declared.devtools_page);
      expect(manifest.content_security_policy ?? {}).not.toHaveProperty('sandbox');
    });
  });

  test('serves the DevTools and panel documents as extension resources', async () => {
    await withExtension(async ({ context, extensionId }) => {
      const page = await context.newPage();
      for (const document of ['devtools.html', 'panel.html']) {
        const response = await page.goto(
          `chrome-extension://${extensionId}/${document}`,
        );
        expect(response?.status(), document).toBe(200);
      }
      await expect(page.locator('#root')).toHaveCount(1);
      await page.close();
    });
  });

  test('ships a toolbar popup that explains where the panel lives', async () => {
    await withExtension(async ({ context, extensionId }) => {
      const worker = context.serviceWorkers()[0]!;
      const action = await worker.evaluate(
        () => chrome.runtime.getManifest().action ?? null,
      );
      expect(action?.default_popup).toBe('popup.html');
      expect(action?.default_title).toContain('DevTools');

      const page = await context.newPage();
      const response = await page.goto(`chrome-extension://${extensionId}/popup.html`);
      expect(response?.status()).toBe(200);
      // DevTools is not open here, so the popup must stay on the instructions.
      await expect(page.getByRole('heading')).toContainText('DevTools');
      await expect(page.locator('#focus')).toBeHidden();
      await page.close();
    });
  });

  test('fails closed when interaction capture is requested for another tab', async () => {
    await withExtension(async ({ context, extensionId }) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/panel.html`);

      const result = await page.evaluate(async () =>
        chrome.runtime.sendMessage({
          type: 'exhibit:start-interactions',
          tabId: 999_999,
          url: 'https://example.test/orders',
        }),
      );

      expect(result).toMatchObject({ status: 'network-only' });
      await page.close();
    });
  });

  test('ignores unrelated runtime messages without responding', async () => {
    await withExtension(async ({ context, extensionId }) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/panel.html`);

      const result = await page.evaluate(async () => {
        try {
          return await chrome.runtime.sendMessage({ type: 'unrelated:message' });
        } catch {
          return 'no-listener';
        }
      });

      expect(result === undefined || result === 'no-listener').toBe(true);
      await page.close();
    });
  });
});
