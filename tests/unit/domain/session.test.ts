import { describe, expect, it } from 'vitest';

import { createSession } from '../../../src/domain/session';

describe('createSession', () => {
  it('creates a stopped ephemeral session with exact default limits', () => {
    expect(createSession('tab-7', 'https://shop.test', 1_000)).toMatchObject({
      tabId: 'tab-7',
      origin: 'https://shop.test',
      phase: 'stopped',
      retention: 'ephemeral',
      limits: {
        maxRequests: 500,
        maxBytes: 8 * 1024 * 1024,
        maxBodyBytes: 512 * 1024,
      },
    });
  });
});
