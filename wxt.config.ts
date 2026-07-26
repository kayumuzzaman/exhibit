import { defineConfig } from 'wxt';

export function buildManifest() {
  return {
    manifest_version: 3,
    name: 'Payloadra',
    version: '0.1.0',
    description: 'Privacy-first browser request evidence for DevTools.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    devtools_page: 'devtools.html',
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
