import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classifyRequest } from '../../src/domain/classification';
import type { Header } from '../../src/domain/model';
import {
  buildNextFixture,
  startNextFixture,
  type NextFixture,
} from '../fixtures/next-app-server';
import { requestWith } from '../helpers/request-factory';

/**
 * The classifier reads Next.js response headers that the framework never
 * promised to keep. Unit tests assert the reading; this suite asserts the
 * contract those readings depend on, against the real production build, so a
 * future Next.js release breaks a test here instead of the panel.
 *
 * Only the response side comes from Next. The request headers are the ones a
 * browser sends for a document or a fetch, which the capture adapter supplies
 * in production and which are covered by their own unit tests.
 */

const SETUP_TIMEOUT_MS = 180_000;

let next: NextFixture;
let base: string;

function headersOf(response: Response): readonly Header[] {
  return [...response.headers.entries()].map(([name, value]) => ({ name, value }));
}

function headerNames(headers: readonly Header[]): readonly string[] {
  return headers.map((header) => header.name.toLowerCase());
}

async function documentAt(path: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'sec-fetch-dest': 'document' },
  });
  await response.arrayBuffer();
  return response;
}

beforeAll(async () => {
  await buildNextFixture();
  next = await startNextFixture();
  base = `${next.origin}/next`;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await next?.close();
});

describe('Next.js response header contract', () => {
  it('marks a prerendered document, and the classifier says so', async () => {
    const response = await documentAt('');
    const headers = headersOf(response);

    // The contract itself: if Next stops sending this, the reading below is
    // no longer possible and the panel must not keep claiming it.
    expect(headerNames(headers)).toContain('x-nextjs-prerender');

    const result = classifyRequest(
      requestWith({
        requestHeaders: [{ name: 'Sec-Fetch-Dest', value: 'document' }],
        responseHeaders: headers,
        responseMime: 'text/html; charset=utf-8',
      }),
    );

    expect(result.kind).toBe('ssr');
    expect(result.evidence).toContain(
      'The HTML was prerendered before this request rather than rendered for it.',
    );
    expect(result.evidence).not.toContain(
      'No prerender header is present, which is consistent with rendering during this request.',
    );
  });

  it('omits the prerender marker on a force-dynamic document', async () => {
    const response = await documentAt('/rsc');
    const headers = headersOf(response);

    // Without this half, the assertion above would pass on a build that sent
    // the header unconditionally, and the evidence would be meaningless.
    expect(headerNames(headers)).not.toContain('x-nextjs-prerender');

    const result = classifyRequest(
      requestWith({
        requestHeaders: [{ name: 'Sec-Fetch-Dest', value: 'document' }],
        responseHeaders: headers,
        responseMime: 'text/html; charset=utf-8',
      }),
    );

    expect(result.kind).toBe('ssr');
    expect(result.evidence).toContain(
      'No prerender header is present, which is consistent with rendering during this request.',
    );
  });

  it('still recognizes an API route that advertises nothing but its Vary list', async () => {
    const response = await fetch(`${base}/api/profile`);
    await response.arrayBuffer();
    const headers = headersOf(response);
    const names = headerNames(headers);

    // Route handlers send no X-Powered-By and no X-Nextjs-* headers, so the
    // router Vary signature is the only framework evidence available here.
    expect(names).not.toContain('x-powered-by');
    expect(names.some((name) => name.startsWith('x-nextjs-'))).toBe(false);

    const vary = response.headers.get('vary')?.toLowerCase() ?? '';
    expect(vary).toContain('next-router-state-tree');
    expect(vary).toContain('next-router-prefetch');

    const result = classifyRequest(
      requestWith({
        url: `${base}/api/profile`,
        responseHeaders: headers,
        responseMime: 'application/json',
      }),
    );

    expect(result.kind).toBe('next-api');
    expect(result.evidence).toContain(
      'Response header Vary lists Next.js router request headers.',
    );
  });
});
