import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { auditPackage } from '../../scripts/audit-package.mjs';
import { buildManifest } from '../../wxt.config';

const OUTPUT_DIR = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));
const built = existsSync(`${OUTPUT_DIR}/manifest.json`);

describe.runIf(built)('shipped package audit', () => {
  it('ships no remote code and no undeclared network destination', async () => {
    const audit = await auditPackage(OUTPUT_DIR);

    expect(audit.remoteUrls).toEqual([]);
    expect(audit.remoteScripts).toEqual([]);
    expect(audit.inlineScripts).toEqual([]);
  });

  // The listing discloses that captured evidence never reaches disk. That is a
  // property of the shipped bytes, not of the source, so it is asserted here.
  it('ships no evidence-at-rest storage API', async () => {
    const audit = await auditPackage(OUTPUT_DIR);

    expect(audit.evidenceAtRest).toEqual([]);
  });

  it('requests exactly the declared permissions and no host access', async () => {
    const audit = await auditPackage(OUTPUT_DIR);
    const declared = buildManifest();

    expect(audit.manifestVersion).toBe(3);
    expect(audit.permissions).toEqual([...declared.permissions].sort());
    expect(audit.optionalHostPermissions).toEqual(
      [...declared.optional_host_permissions].sort(),
    );
    expect(audit.hostPermissions).toEqual([]);
    expect(audit.externallyConnectable).toBeNull();
  });

  it('ships the DevTools surface and the injected interaction scripts', async () => {
    const audit = await auditPackage(OUTPUT_DIR);

    expect(audit.files).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'devtools.html',
        'panel.html',
        'background.js',
        'interaction.js',
        'interaction-main.js',
      ]),
    );
  });
});

describe('package audit prerequisites', () => {
  it('documents that the audit needs a production build', () => {
    // `pnpm verify` builds before `pnpm audit:package` and `pnpm test:e2e`, so
    // this suite is skipped only when the tests run against a clean checkout.
    expect(typeof built).toBe('boolean');
  });
});
