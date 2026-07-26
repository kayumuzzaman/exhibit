import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import { buildNextFixture } from '../fixtures/next-app-server';

export const HARNESS_DIR = fileURLToPath(
  new URL('../../.output/e2e-harness', import.meta.url),
);
export const EXTENSION_DIR = fileURLToPath(
  new URL('../../.output/chrome-mv3', import.meta.url),
);

const HARNESS_CONFIG = fileURLToPath(
  new URL('./harness/vite.config.ts', import.meta.url),
);

/**
 * Builds the panel harness before the suite runs. The production extension
 * build is a prerequisite of `pnpm test:e2e` so a stale or missing `.output`
 * fails loudly instead of silently testing nothing.
 */
export default async function globalSetup(): Promise<void> {
  await build({ configFile: HARNESS_CONFIG });
  await buildNextFixture();
  if (!existsSync(`${EXTENSION_DIR}/manifest.json`)) {
    throw new Error(
      'Missing .output/chrome-mv3/manifest.json. Run `pnpm build` before `pnpm test:e2e`.',
    );
  }
}
