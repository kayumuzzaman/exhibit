import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../wxt.config';

describe('buildManifest', () => {
  it('declares only the minimum MV3 permissions', () => {
    const manifest = buildManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('120');
    expect(manifest.permissions).toEqual(['storage', 'scripting']);
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(JSON.stringify(manifest)).not.toContain('debugger');
  });
});
