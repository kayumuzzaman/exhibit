import { describe, expect, it } from 'vitest';

import { bootDevtools, type DevtoolsPanels } from '../../../src/devtools/boot';

describe('bootDevtools', () => {
  it('creates the Payloadra DevTools panel with bundled assets', () => {
    const calls: [string, string, string, (panel: unknown) => void][] = [];
    const panels: DevtoolsPanels = {
      create: (title, icon, page, callback) => {
        calls.push([title, icon, page, callback]);
      },
    };

    bootDevtools(panels);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual([
      'Payloadra',
      'icons/payloadra.svg',
      'panel.html',
    ]);
    expect(() => calls[0]?.[3]({})).not.toThrow();
  });
});
