import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.pnpm-store/**',
      '.superpowers/**',
      '.worktrees/**',
      '.wxt/**',
      'coverage/**',
      'tests/fixtures/next-app/.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        defineBackground: 'readonly',
        defineUnlistedScript: 'readonly',
      },
    },
  },
  {
    // Playwright requires an object destructuring pattern for fixture inputs.
    files: ['tests/e2e/extension.fixture.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, chrome: 'readonly' },
    },
  },
  {
    files: ['tests/fixtures/**/public/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
  {
    files: ['tests/fixtures/next-app/**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
