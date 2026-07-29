import { describe, expect, it } from 'vitest';

import { toSafeCurl } from '../../../src/domain/curl';
import { toSanitizedHar } from '../../../src/domain/har-export';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { toQaReport } from '../../../src/domain/report-export';
import { freezeSession } from '../../../src/domain/ring-buffer';
import { createSession } from '../../../src/domain/session';
import { encodeStoredSession } from '../../../src/infrastructure/storage/schema';
import { requestWith } from '../../helpers/request-factory';
import type { BodyContent } from '../../../src/domain/model';

const STRIPE_KEY = 'sk_live_51H8xAbCdEfGhIjKlMnOp';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop';
const BASIC = 'dXNlcjpzM2NyZXRQYXNzd29yZA==';
const SHORT_BASIC = 'dTpw';
const AWS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY';

function body(mimeType: string | undefined, text: string): BodyContent {
  return {
    state: 'available',
    size: text.length,
    capturedSize: text.length,
    text,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

/** Every surface a captured request can reach outside the capture pipeline. */
function surfaces(
  overrides: Record<string, unknown>,
): Readonly<Record<string, string>> {
  const session = freezeSession(
    redactSession(
      {
        ...createSession('tab-1', 'https://app.test', 1_000),
        requests: [requestWith(overrides)],
      },
      DEFAULT_REDACTION_CONFIG,
    ),
  );
  return {
    panel: JSON.stringify(session),
    har: toSanitizedHar(session),
    report: toQaReport(session),
    curl: toSafeCurl(session.requests[0]!),
    storage: JSON.stringify(encodeStoredSession(session)),
  };
}

const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
  [
    'a credential embedded in the URL path',
    { url: `https://api.test/download/${STRIPE_KEY}` },
    STRIPE_KEY,
  ],
  ['a JWT embedded in the URL path', { url: `https://api.test/v1/${JWT}/data` }, JWT],
  [
    'a storage signature query parameter',
    { url: 'https://api.test/blob?sv=2021-08-06&sig=8Fj2QzAbCdEfGh' },
    '8Fj2QzAbCdEfGh',
  ],
  [
    'a PKCE verifier query parameter',
    { url: 'https://api.test/cb?code_verifier=dBjftJeZ4CVPmB92K27u' },
    'dBjftJeZ4CVPmB92K27u',
  ],
  [
    'JSON posted as text/plain',
    { requestBody: body('text/plain', '{"password":"hunter2秘"}') },
    'hunter2秘',
  ],
  [
    'JSON posted without a MIME type',
    { requestBody: body(undefined, '{"apiKey":"hunter2秘"}') },
    'hunter2秘',
  ],
  [
    'an XML credential element',
    { requestBody: body('application/xml', '<password>hunter2秘</password>') },
    'hunter2秘',
  ],
  [
    'an HTTP Basic value under a non-standard header',
    { requestHeaders: [{ name: 'X-Proxy-Auth', value: `Basic ${BASIC}` }] },
    BASIC,
  ],
  [
    'a short HTTP Basic value under a non-sensitive custom header',
    { requestHeaders: [{ name: 'X-Upstream', value: `Basic ${SHORT_BASIC}` }] },
    SHORT_BASIC,
  ],
  [
    'an Authentication header',
    { requestHeaders: [{ name: 'Authentication', value: `Basic ${BASIC}` }] },
    BASIC,
  ],
  [
    'a bare X-Session header',
    { requestHeaders: [{ name: 'X-Session', value: 'sessionCookieValue1' }] },
    'sessionCookieValue1',
  ],
  [
    'a request signature header',
    { requestHeaders: [{ name: 'X-Amz-Signature', value: 'deadbeefcafe1234' }] },
    'deadbeefcafe1234',
  ],
  [
    'a secret access key header',
    { requestHeaders: [{ name: 'X-Access-Key', value: AWS_SECRET }] },
    AWS_SECRET,
  ],
];

/**
 * Known limit: an opaque path segment or query value with no recognizable
 * credential format (a bare webhook token, an OAuth `code`) is indistinguishable
 * from an ordinary identifier, and redacting every such value would remove the
 * routes the product exists to show. Those are documented in docs/PRIVACY.md.
 */
describe('no captured credential reaches any output surface', () => {
  it.each(CASES)('redacts %s', (_label, overrides, secret) => {
    const leaked = Object.entries(surfaces(overrides))
      .filter(([, text]) => text.includes(secret))
      .map(([surface]) => surface);

    expect(leaked, `leaked via ${leaked.join(', ')}`).toEqual([]);
  });

  it('keeps the surrounding route readable while redacting one segment', () => {
    const { panel } = surfaces({
      url: `https://api.test/v1/orders/${STRIPE_KEY}/items`,
    });

    expect(panel).toContain('/v1/orders/');
    expect(panel).toContain('/items');
    expect(panel).toContain('[REDACTED]');
  });

  it('leaves descriptive names that merely resemble credentials intact', () => {
    const { panel } = surfaces({
      requestBody: body(
        'application/json',
        '{"sessionDuration":30,"signatureVersion":"v4","tokenizerModel":"base"}',
      ),
    });

    expect(panel).toContain('30');
    expect(panel).toContain('v4');
    expect(panel).toContain('base');
  });
});
