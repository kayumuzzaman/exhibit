import { describe, expect, it } from 'vitest';

import { PRODUCTION_CAPTURE_OPTIONS } from '../../../src/panel/capture-policy';

describe('production capture policy', () => {
  it('records static resources so the API-only control can hide or reveal them', () => {
    expect(PRODUCTION_CAPTURE_OPTIONS).toEqual({ includeStatic: true });
  });
});
