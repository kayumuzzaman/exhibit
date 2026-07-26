import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { startGenericFixture } from '../tests/fixtures/generic/server.ts';

/**
 * Loads the built extension into a dedicated profile of the locally installed
 * Google Chrome and reports what a real browser can confirm without driving the
 * DevTools window, which Playwright cannot attach to.
 */

const EXTENSION_DIR = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

async function main() {
  const fixture = await startGenericFixture({});
  const profile = await mkdtemp(join(tmpdir(), 'payloadra-chrome-smoke-'));
  const results = [];
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
      ],
    });

    let worker = context.serviceWorkers()[0];
    if (worker === undefined) {
      worker = await context
        .waitForEvent('serviceworker', { timeout: 15_000 })
        .catch(() => undefined);
    }

    const page = await context.newPage();
    if (worker === undefined) {
      results.push([
        'extension load',
        'blocked — this Chrome build refuses --load-extension; load .output/chrome-mv3 manually from chrome://extensions',
      ]);
    } else {
      const extensionId = new URL(worker.url()).host;
      results.push(['service worker registered', `extension id ${extensionId}`]);

      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      results.push([
        'manifest',
        `v${manifest.manifest_version}, permissions ${JSON.stringify(manifest.permissions)}, host permissions ${JSON.stringify(manifest.host_permissions ?? [])}`,
      ]);
      results.push(['devtools page', String(manifest.devtools_page)]);

      for (const document of ['devtools.html', 'panel.html']) {
        const response = await page.goto(
          `chrome-extension://${extensionId}/${document}`,
        );
        results.push([`extension resource ${document}`, `HTTP ${response?.status()}`]);
      }
    }

    const remote = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname))
        remote.push(request.url());
    });

    await page.goto(`${fixture.origin}/`);
    const actions = await page.evaluate(async () => {
      await globalThis.fixtureActions.saveProfile('Ada');
      await globalThis.fixtureActions.graphql();
      const response = await globalThis.fixtureActions.loadProfile();
      return response.status;
    });
    results.push(['fixture page traffic', `profile load HTTP ${actions}`]);
    results.push([
      'remote requests observed',
      remote.length === 0 ? 'none' : remote.join(', '),
    ]);

    const version = await page.evaluate(() => navigator.userAgent);
    results.push(['browser', version]);
    await page.close();
  } finally {
    await context?.close();
    await rm(profile, { force: true, recursive: true });
    await fixture.close();
  }

  for (const [label, value] of results) {
    process.stdout.write(`- ${label}: ${value}\n`);
  }
}

await main();
