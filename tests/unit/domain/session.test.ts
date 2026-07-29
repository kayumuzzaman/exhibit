import { describe, expect, it } from 'vitest';

import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { freezeSession } from '../../../src/domain/ring-buffer';
import { closeInterruptedSession, createSession } from '../../../src/domain/session';

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

  it.each(['starting', 'recording', 'stopping'] as const)(
    'closes a recovered %s session because its capture sources no longer exist',
    (phase) => {
      const recovered = freezeSession(
        redactSession(
          {
            ...createSession('tab-7', 'https://shop.test', 1_000),
            phase,
            startedAt: 1_000,
          },
          DEFAULT_REDACTION_CONFIG,
        ),
      );

      expect(closeInterruptedSession(recovered, 2_000)).toMatchObject({
        phase: 'stopped',
        startedAt: 1_000,
        stoppedAt: 2_000,
      });
    },
  );

  it('keeps an already stopped recovered session unchanged', () => {
    const recovered = freezeSession(
      redactSession(
        createSession('tab-7', 'https://shop.test', 1_000),
        DEFAULT_REDACTION_CONFIG,
      ),
    );

    expect(closeInterruptedSession(recovered, 2_000)).toBe(recovered);
  });
});
