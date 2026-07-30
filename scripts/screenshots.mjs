import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';

import { startGenericFixture } from '../tests/fixtures/generic/server.ts';
import {
  startNextFixture,
  buildNextFixture,
} from '../tests/fixtures/next-app-server.ts';
import { ExhibitDriver } from '../tests/e2e/devtools-driver.ts';

/**
 * Captures the Chrome Web Store screenshot set from the real panel driven
 * against the real fixtures. Output is exactly 1280 x 800, light theme, with the
 * harness controls hidden so only the product surface is visible.
 */

const HARNESS_CONFIG = fileURLToPath(
  new URL('../tests/e2e/harness/vite.config.ts', import.meta.url),
);
const HARNESS_DIR = fileURLToPath(new URL('../.output/e2e-harness', import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL('../docs/screenshots', import.meta.url));

async function main() {
  await build({ configFile: HARNESS_CONFIG });
  await buildNextFixture();
  await rm(OUTPUT_DIR, { force: true, recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const next = await startNextFixture();
  const fixture = await startGenericFixture({
    harnessDir: HARNESS_DIR,
    nextOrigin: next.origin,
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1_280, height: 800 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();
  const captured = [];

  // The controls must stay a grid item so the panel keeps the `1fr` row and
  // fills the full 800 px frame; collapsing them to zero height hides them
  // without changing the layout the product actually renders into.
  const COLLAPSED = 'height:0;padding:0;border:0;overflow:hidden;visibility:hidden';

  async function shot(name) {
    await page.locator('#fixture-panel').evaluate((node, style) => {
      node.setAttribute('style', style);
    }, COLLAPSED);
    await page.waitForTimeout(200);
    const path = `${OUTPUT_DIR}/${name}.png`;
    await page.screenshot({ path });
    await page.locator('#fixture-panel').evaluate((node) => {
      node.removeAttribute('style');
    });
    captured.push(name);
  }

  try {
    await page.goto(`${fixture.origin}/panel/?screenshot=stable`);
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}',
    });
    const exhibit = new ExhibitDriver(page);
    await exhibit.ready();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.locator('.app-shell[data-theme="light"]').waitFor();

    // 1. Recording ledger with representative traffic.
    await exhibit.startRecording();
    await exhibit.trigger('save-profile');
    await exhibit.trigger('load-profile');
    await exhibit.trigger('graphql');
    await exhibit.trigger('submit-form');
    await exhibit.trigger('failing');
    await exhibit.trigger('slow');
    await shot('01-recording-ledger');

    // Keep the overview ledger broad in the first frame, then use the product's
    // real resize control to give detail evidence enough room in frames 2–5.
    await page.getByRole('separator', { name: 'Resize request ledger' }).press('Home');

    // 2. Explain a real Next.js Server Action with its evidence disclosure.
    await exhibit.openNextFixture();
    await exhibit.triggerInNextFixture('#next-save-action');
    // Selected by the primary columns, which every ledger width keeps: the
    // Server Action is the POST the fixture page makes back to its own route.
    await exhibit
      .requestRows()
      .filter({ hasText: '/next' })
      .filter({ hasText: 'POST' })
      .first()
      .click();
    await exhibit.openExplain();
    const explainEvidence = page.locator('.explain-evidence');
    await explainEvidence.evaluate((node) => {
      node.open = true;
    });
    await explainEvidence.scrollIntoViewIfNeeded();
    await shot('02-explain-server-action');

    // 3. Inspect timing for the slow call.
    await exhibit.openRequest('/api/slow');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Timing');
    await shot('03-inspect-timing');

    // 4. Partial React Flight decode beside its raw protocol fallback.
    await exhibit.setApiOnly(false);
    await exhibit.trigger('flight-partial');
    await exhibit.openRequest('/api/flight-partial');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Response');
    await page.locator('.body-viewer').scrollIntoViewIfNeeded();
    await shot('04-flight-raw-fallback');

    // 5. Redaction in place across header, query, and body.
    await exhibit.trigger('secret');
    await exhibit.openRequest('/api/secret');
    await exhibit.openInspect();
    await exhibit.openEvidenceTab('Request');
    await shot('05-redaction');
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
    await next.close();
  }

  for (const name of captured) {
    process.stdout.write(`- docs/screenshots/${name}.png\n`);
  }
}

await main();
