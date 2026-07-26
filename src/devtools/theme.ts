export type ResolvedDevtoolsTheme = 'dark' | 'light';

export interface DevtoolsThemeSource {
  getSnapshot(): ResolvedDevtoolsTheme;
  subscribe(listener: () => void): () => void;
}

export interface DevtoolsThemeApi {
  readonly themeName?: unknown;
  setThemeChangeHandler?(callback?: (theme: 'dark' | 'default') => void): void;
}

function resolveTheme(
  value: unknown,
  fallback: ResolvedDevtoolsTheme,
): ResolvedDevtoolsTheme {
  if (value === 'dark') return 'dark';
  if (value === 'default') return 'light';
  return fallback;
}

export function createDevtoolsThemeSource(
  api: DevtoolsThemeApi,
  fallback: ResolvedDevtoolsTheme,
): DevtoolsThemeSource {
  let current = resolveTheme(api.themeName, fallback);
  const listeners = new Set<() => void>();

  api.setThemeChangeHandler?.((theme) => {
    const next = resolveTheme(theme, fallback);
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener());
  });

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const FALLBACK_DEVTOOLS_THEME_SOURCE: DevtoolsThemeSource = {
  getSnapshot: () => 'dark',
  subscribe: () => () => undefined,
};
