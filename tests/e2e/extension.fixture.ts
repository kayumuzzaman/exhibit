import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from 'playwright/test';

import {
  startGenericFixture,
  startThirdPartyFixture,
  type FixtureServer,
} from '../fixtures/generic/server';
import { startNextFixture, type NextFixture } from '../fixtures/next-app-server';
import { EXTENSION_DIR, HARNESS_DIR } from './global-setup';
import { PayloadraDriver } from './devtools-driver';

export { FIXTURE_PROFILE, FIXTURE_SECRETS } from '../fixtures/generic/server';

export type PayloadraFixtures = {
  panel: Page;
  payloadra: PayloadraDriver;
  consoleErrors: string[];
  allowedConsoleErrors: RegExp[];
};

export type PayloadraWorkerFixtures = {
  generic: FixtureServer;
  thirdParty: FixtureServer;
  next: NextFixture;
};

export const test = base.extend<PayloadraFixtures, PayloadraWorkerFixtures>({
  next: [
    async ({}, use) => {
      const server = await startNextFixture();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  generic: [
    async ({ next }, use) => {
      const server = await startGenericFixture({
        harnessDir: HARNESS_DIR,
        nextOrigin: next.origin,
      });
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  thirdParty: [
    async ({}, use) => {
      const server = await startThirdPartyFixture();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  allowedConsoleErrors: async ({}, use) => {
    await use([]);
  },

  consoleErrors: async ({}, use) => {
    await use([]);
  },

  panel: async ({ page, generic, consoleErrors, allowedConsoleErrors }, use) => {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(`${generic.origin}/panel/`);
    await use(page);

    const unexpected = consoleErrors.filter(
      (entry) => !allowedConsoleErrors.some((pattern) => pattern.test(entry)),
    );
    expect(unexpected, 'panel produced unexpected console output').toEqual([]);
  },

  payloadra: async ({ panel }, use) => {
    const driver = new PayloadraDriver(panel);
    await driver.ready();
    await use(driver);
  },
});

export { expect } from 'playwright/test';

export type ExtensionContext = Readonly<{
  context: BrowserContext;
  extensionId: string;
}>;

/**
 * Launches the built MV3 extension in a persistent Chromium profile. The
 * temporary profile directory is always removed, even when a test fails.
 */
export async function withExtension<T>(
  run: (context: ExtensionContext) => Promise<T>,
): Promise<T> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'payloadra-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    return await run({ context, extensionId });
  } finally {
    await context.close();
    await rm(userDataDir, { force: true, recursive: true });
  }
}
