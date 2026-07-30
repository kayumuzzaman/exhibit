import { defineConfig } from 'wxt';

export function buildManifest() {
  return {
    manifest_version: 3,
    name: 'Exhibit',
    version: '0.1.0',
    description:
      'Reads Next.js Server Actions, RSC, and Flight payloads in DevTools, and redacts credentials before anything is shown.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    devtools_page: 'devtools.html',
    // The toolbar entry is declared by `entrypoints/popup.html`, which WXT maps
    // onto `action`. Chrome exposes no way to open DevTools from an extension,
    // so that popup explains where the panel lives instead of doing nothing.
    minimum_chrome_version: '120',
    permissions: ['storage', 'scripting'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  };
}

const manifest = buildManifest();
Reflect.deleteProperty(manifest, 'manifest_version');

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest,
});
