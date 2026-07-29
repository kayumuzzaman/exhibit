import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_REDACTION_FIELD_NAMES } from '../../../src/features/settings/redaction-settings';
import {
  DEFAULT_PAYLOADRA_SETTINGS,
  buildRedactionConfig,
  createPayloadraSettingsRepository,
  normalizeCustomFieldNames,
  parseCustomFieldNames,
} from '../../../src/features/settings/payloadra-settings';

describe('Payloadra settings', () => {
  it('normalizes, deduplicates, and bounds user field names case-insensitively', () => {
    expect(
      normalizeCustomFieldNames([
        ' Private Note ',
        'private-note',
        '',
        'X-Customer-Key',
      ]),
    ).toEqual(['Private Note', 'X-Customer-Key']);
    expect(parseCustomFieldNames('Private Note,\nX-Customer-Key')).toEqual([
      'Private Note',
      'X-Customer-Key',
    ]);
  });

  it('merges custom names without allowing mandatory defaults to be relaxed', () => {
    const config = buildRedactionConfig({
      ...DEFAULT_PAYLOADRA_SETTINGS,
      customFieldNames: ['Private Note'],
    });

    expect(config.fieldNames).toEqual([
      ...DEFAULT_REDACTION_FIELD_NAMES,
      'Private Note',
    ]);
    expect(config).toMatchObject({
      redactAuthorization: true,
      redactCookies: true,
      scanValuePatterns: true,
    });
  });

  it('loads defaults for malformed local data and saves a validated v1 envelope', async () => {
    const values = new Map<string, unknown>([
      ['payloadra:settings:v1', { version: 1, customFieldNames: 'unsafe' }],
    ]);
    const area = {
      get: vi.fn(async (key: string) =>
        values.has(key) ? { [key]: values.get(key) } : {},
      ),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) values.set(key, value);
      }),
      setAccessLevel: vi.fn(async () => undefined),
    };
    const repository = createPayloadraSettingsRepository(area);

    expect(await repository.load()).toEqual(DEFAULT_PAYLOADRA_SETTINGS);

    const saved = await repository.save({
      theme: 'dark',
      customFieldNames: [' Private Note ', 'private-note'],
    });
    expect(saved).toEqual({
      theme: 'dark',
      customFieldNames: ['Private Note'],
    });
    expect(values.get('payloadra:settings:v1')).toEqual({
      version: 1,
      theme: 'dark',
      customFieldNames: ['Private Note'],
    });

    await repository.restrictToTrustedContexts();
    expect(area.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });
});
