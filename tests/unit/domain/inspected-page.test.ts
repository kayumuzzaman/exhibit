import { describe, expect, it } from 'vitest';

import {
  LOCAL_FILE_ORIGIN,
  RESTRICTED_PAGE_ORIGIN,
  UNKNOWN_PAGE_ORIGIN,
  safeInspectedOrigin,
} from '../../../src/domain/inspected-page';

describe('safe inspected origin', () => {
  it.each([
    ['chrome://settings/privacy', RESTRICTED_PAGE_ORIGIN],
    ['edge://settings', RESTRICTED_PAGE_ORIGIN],
    ['about:blank', RESTRICTED_PAGE_ORIGIN],
    ['file:///Users/dev/report.html', LOCAL_FILE_ORIGIN],
  ])('maps %s to a safe label without echoing the URL', (href, expected) => {
    expect(safeInspectedOrigin({ href, origin: 'null' })).toBe(expected);
  });

  it('returns the normalized origin for a real web page', () => {
    expect(
      safeInspectedOrigin({
        href: 'https://app.test/orders?token=secret',
        origin: 'https://app.test',
      }),
    ).toBe('https://app.test');
  });

  it('falls back when the origin is not a usable URL', () => {
    expect(
      safeInspectedOrigin({ href: 'https://app.test/x', origin: 'https://' }),
    ).toBe(UNKNOWN_PAGE_ORIGIN);
  });

  it.each([
    ['a missing evaluation result', undefined],
    ['a null result', null],
    ['a primitive result', 'https://app.test'],
    ['a result without string fields', { href: 7, origin: {} }],
    ['a non-HTTP origin', { href: 'ws://app.test', origin: 'ws://app.test' }],
  ])('falls back for %s', (_label, value) => {
    expect(safeInspectedOrigin(value)).toBe(UNKNOWN_PAGE_ORIGIN);
  });
});
