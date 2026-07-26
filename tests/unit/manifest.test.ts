import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../wxt.config';

describe('buildManifest', () => {
  it('declares only the minimum MV3 permissions', () => {
    const manifest = buildManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('120');
    expect(manifest.permissions).toEqual(['storage', 'scripting']);
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.icons).toEqual({
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    });
    expect(JSON.stringify(manifest)).not.toContain('debugger');
  });
});
