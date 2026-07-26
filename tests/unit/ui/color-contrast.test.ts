import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../../helpers/color-contrast';

describe('small interface text contrast', () => {
  it.each([
    ['dark primary control', '#10151a', '#00b8d9'],
    ['light primary control', '#ffffff', '#00758d'],
    ['dark primary hover', '#10151a', '#00b8d9'],
    ['light primary hover', '#ffffff', '#00758d'],
    ['dark live status', '#00b8d9', '#15191f'],
    ['light live status', '#00758d', '#f4f6f5'],
    ['dark focus indicator', '#72dbef', '#15191f'],
    ['light focus indicator', '#006d85', '#f4f6f5'],
  ])('%s is at least WCAG AA 4.5:1', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
