import { describe, expect, it, vi } from 'vitest';

import { createDevtoolsThemeSource } from '../../../src/devtools/theme';

describe('createDevtoolsThemeSource', () => {
  it('uses the supplied fallback when older or malformed APIs expose no theme', () => {
    expect(createDevtoolsThemeSource({}, 'light').getSnapshot()).toBe('light');
    expect(
      createDevtoolsThemeSource({ themeName: 'unsupported' }, 'dark').getSnapshot(),
    ).toBe('dark');
  });

  it('notifies subscribers only when the supported theme actually changes', () => {
    let handler: ((theme: 'dark' | 'default') => void) | undefined;
    const source = createDevtoolsThemeSource(
      {
        themeName: 'default',
        setThemeChangeHandler(callback) {
          handler = callback;
        },
      },
      'dark',
    );
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);

    handler?.('default');
    handler?.('dark');
    handler?.('dark');
    expect(source.getSnapshot()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    handler?.('default');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
