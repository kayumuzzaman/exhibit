import { describe, expect, it } from 'vitest';

import { createCorruptSession } from '../../../src/infrastructure/storage/schema';
import { recoveryForPage } from '../../../src/panel/recovery';

describe('panel recovery selection', () => {
  it('keeps a corrupt session identity so explicit Clear can remove its raw record', () => {
    const corrupt = createCorruptSession('tab-9:corrupt', 'tab-9');

    const recovered = recoveryForPage(corrupt, 'tab-9', 'https://app.test');

    expect(recovered).toMatchObject({
      id: 'tab-9:corrupt',
      tabId: 'tab-9',
      origin: 'https://app.test',
    });
    expect(recovered?.warnings).toContainEqual(
      expect.objectContaining({ code: 'corrupt-session' }),
    );
  });

  it('rejects healthy evidence from a different inspected origin', () => {
    const corrupt = createCorruptSession('tab-9:corrupt', 'tab-9');
    const healthy = {
      ...corrupt,
      origin: 'https://other.test',
      warnings: [],
    };

    expect(recoveryForPage(healthy, 'tab-9', 'https://app.test')).toBeNull();
  });
});
