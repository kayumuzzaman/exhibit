import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../../../.output/e2e-harness', import.meta.url));

export default defineConfig({
  root,
  base: '/panel/',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
  },
  logLevel: 'warn',
});
