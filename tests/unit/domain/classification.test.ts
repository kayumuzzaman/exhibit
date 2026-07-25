import { describe, expect, it } from 'vitest';

import { classifyRequest } from '../../../src/domain/classification';
import { requestWith } from '../../helpers/request-factory';

describe('classifyRequest', () => {
  it('confirms a Server Action only from POST plus nonempty protocol metadata', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestHeaders: [{ name: 'Next-Action', value: '40f3a8b1' }],
        responseMime: 'text/x-component',
      }),
    );

    expect(result).toEqual({
      kind: 'next-server-action',
      confidence: 'confirmed',
      evidence: [
        'Request method is POST.',
        'Request header Next-Action is present.',
        'Response MIME type is text/x-component.',
        'Next.js action and Flight headers are internal and version-sensitive.',
      ],
      actionId: '40f3a8b1',
    });
    expect(JSON.stringify(result)).not.toContain('functionName');
  });

  it('does not treat a Next-Action header on a GET as a Server Action', () => {
    const result = classifyRequest(
      requestWith({
        requestHeaders: [{ name: 'next-action', value: 'opaque-action-id' }],
        responseMime: 'text/x-component',
      }),
    );

    expect(result).toMatchObject({ kind: 'rsc', confidence: 'likely' });
    expect(result).not.toHaveProperty('actionId');
  });

  it('does not treat an empty Next-Action header as a Server Action', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        url: 'https://app.test/api/save',
        requestHeaders: [{ name: 'NEXT-ACTION', value: '   ' }],
        responseMime: 'application/json',
      }),
    );

    expect(result).toMatchObject({ kind: 'api', confidence: 'likely' });
    expect(result).not.toHaveProperty('actionId');
  });

  it('does not call every /api path a confirmed Next.js route', () => {
    expect(
      classifyRequest(requestWith({ url: 'https://plain.test/api/users' })),
    ).toEqual({
      kind: 'api',
      confidence: 'likely',
      evidence: ['URL path contains /api/.'],
    });
  });

  it('marks an API path with direct Next.js response evidence as probable only', () => {
    const result = classifyRequest(
      requestWith({
        url: 'https://app.test/api/users',
        responseMime: 'application/json; charset=utf-8',
        responseHeaders: [{ name: 'X-Powered-By', value: 'Next.js' }],
      }),
    );

    expect(result).toEqual({
      kind: 'next-api',
      confidence: 'likely',
      evidence: [
        'URL path contains /api/.',
        'Response header X-Powered-By reports Next.js.',
        'A browser observer cannot prove which server-side route implementation handled the request.',
      ],
    });
  });

  it('accepts Next.js-specific cache metadata as probable framework evidence', () => {
    const result = classifyRequest(
      requestWith({
        url: 'https://app.test/api/catalog',
        responseHeaders: [{ name: 'x-nextjs-cache', value: 'HIT' }],
      }),
    );

    expect(result).toMatchObject({
      kind: 'next-api',
      confidence: 'likely',
      evidence: [
        'URL path contains /api/.',
        'Response header X-Nextjs-Cache is present.',
        'A browser observer cannot prove which server-side route implementation handled the request.',
      ],
    });
  });

  it('confirms GraphQL from the request protocol content type', () => {
    expect(
      classifyRequest(
        requestWith({
          method: 'POST',
          requestBody: {
            state: 'available',
            size: 18,
            capturedSize: 18,
            text: 'query { viewer }',
            mimeType: 'application/graphql',
          },
        }),
      ),
    ).toEqual({
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['Request MIME type is application/graphql.'],
    });
  });

  it('confirms GraphQL from a structured JSON query body', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestBody: {
          state: 'available',
          size: 55,
          capturedSize: 55,
          text: '{"operationName":"Viewer","query":"query Viewer { me }"}',
          mimeType: 'application/json',
        },
      }),
    );

    expect(result).toEqual({
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['JSON request body contains a GraphQL query field.'],
    });
  });

  it('does not infer GraphQL from operationName without a query', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestBody: {
          state: 'available',
          size: 26,
          capturedSize: 26,
          text: '{"operationName":"Viewer"}',
          mimeType: 'application/json',
        },
      }),
    );

    expect(result).toMatchObject({ kind: 'api', confidence: 'likely' });
  });

  it('does not infer GraphQL from malformed JSON', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestBody: {
          state: 'available',
          size: 10,
          capturedSize: 10,
          text: '{"query":',
          mimeType: 'application/json',
        },
      }),
    );

    expect(result).toMatchObject({ kind: 'api', confidence: 'likely' });
  });

  it('confirms GraphQL from a nonempty GET query parameter', () => {
    const result = classifyRequest(
      requestWith({
        url: 'https://api.test/graphql?query=query%20Viewer%20%7Bme%7D',
      }),
    );

    expect(result).toEqual({
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['URL query contains a nonempty GraphQL query parameter.'],
    });
  });

  it('does not mistake a generic search query parameter for GraphQL', () => {
    const result = classifyRequest(
      requestWith({
        url: 'https://shop.test/search?query=running+shoes',
        responseMime: 'text/html',
      }),
    );

    expect(result).toMatchObject({
      kind: 'document',
      confidence: 'likely',
    });
  });

  it('confirms GraphQL from the response protocol MIME type', () => {
    const result = classifyRequest(
      requestWith({ responseMime: 'application/graphql-response+json' }),
    );

    expect(result).toEqual({
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['Response MIME type is application/graphql-response+json.'],
    });
  });

  it('confirms an URL-encoded browser form from direct request metadata', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestBody: {
          state: 'available',
          size: 9,
          capturedSize: 9,
          text: 'name=Kaya',
          mimeType: 'application/x-www-form-urlencoded; charset=utf-8',
        },
      }),
    );

    expect(result).toEqual({
      kind: 'form',
      confidence: 'confirmed',
      evidence: ['Request MIME type is application/x-www-form-urlencoded.'],
    });
  });

  it('confirms a multipart browser form from direct request metadata', () => {
    const result = classifyRequest(
      requestWith({
        method: 'POST',
        requestBody: {
          state: 'available',
          size: 0,
          capturedSize: 0,
          text: '',
          mimeType: 'multipart/form-data; boundary=abc',
        },
      }),
    );

    expect(result).toEqual({
      kind: 'form',
      confidence: 'confirmed',
      evidence: ['Request MIME type is multipart/form-data.'],
    });
  });

  it('confirms an RSC navigation only from combined direct Flight signals', () => {
    const result = classifyRequest(
      requestWith({
        url: 'https://app.test/dashboard?_rsc=abc',
        requestHeaders: [
          { name: 'RSC', value: '1' },
          { name: 'Next-Router-State-Tree', value: '%5B%22%22%5D' },
        ],
        responseMime: 'text/x-component; charset=utf-8',
      }),
    );

    expect(result).toEqual({
      kind: 'rsc',
      confidence: 'confirmed',
      evidence: [
        'Request header RSC is present.',
        'Request header Next-Router-State-Tree is present.',
        'Response MIME type is text/x-component.',
        'URL query contains _rsc.',
        'Next.js RSC headers and query markers are internal and version-sensitive.',
      ],
    });
  });

  it('keeps a lone internal _rsc query marker at likely confidence', () => {
    expect(
      classifyRequest(requestWith({ url: 'https://app.test/dashboard?_rsc=abc' })),
    ).toEqual({
      kind: 'rsc',
      confidence: 'likely',
      evidence: [
        'URL query contains _rsc.',
        'Next.js RSC headers and query markers are internal and version-sensitive.',
      ],
    });
  });

  it('keeps a lone Flight response MIME at likely confidence', () => {
    expect(classifyRequest(requestWith({ responseMime: 'text/x-component' }))).toEqual({
      kind: 'rsc',
      confidence: 'likely',
      evidence: [
        'Response MIME type is text/x-component.',
        'Next.js RSC headers and query markers are internal and version-sensitive.',
      ],
    });
  });

  it('labels an HTML Next.js navigation as likely SSR without claiming proof', () => {
    const result = classifyRequest(
      requestWith({
        requestHeaders: [{ name: 'Sec-Fetch-Dest', value: 'document' }],
        responseHeaders: [{ name: 'x-powered-by', value: 'Next.js' }],
        responseMime: 'text/html; charset=utf-8',
      }),
    );

    expect(result).toEqual({
      kind: 'ssr',
      confidence: 'likely',
      evidence: [
        'Request header Sec-Fetch-Dest is document.',
        'Response MIME type is text/html.',
        'Response header X-Powered-By reports Next.js.',
        'Browser-visible evidence cannot distinguish server rendering from prerendered HTML with certainty.',
      ],
    });
  });

  it('confirms a document destination from direct fetch metadata', () => {
    expect(
      classifyRequest(
        requestWith({
          requestHeaders: [{ name: 'sec-fetch-dest', value: 'document' }],
          responseMime: 'text/html',
        }),
      ),
    ).toEqual({
      kind: 'document',
      confidence: 'confirmed',
      evidence: [
        'Request header Sec-Fetch-Dest is document.',
        'Response MIME type is text/html.',
      ],
    });
  });

  it('treats HTML alone as a likely document', () => {
    expect(classifyRequest(requestWith({ responseMime: 'text/html' }))).toEqual({
      kind: 'document',
      confidence: 'likely',
      evidence: ['Response MIME type is text/html.'],
    });
  });

  it('labels static-looking assets without claiming a path proves origin', () => {
    expect(
      classifyRequest(
        requestWith({
          url: 'https://app.test/_next/static/chunks/app.js',
          responseMime: 'application/javascript',
        }),
      ),
    ).toEqual({
      kind: 'static',
      confidence: 'likely',
      evidence: [
        'URL path looks like a static asset.',
        'Response MIME type is application/javascript.',
      ],
    });
  });

  it('labels XMLHttpRequest convention evidence as likely fetch/XHR', () => {
    expect(
      classifyRequest(
        requestWith({
          requestHeaders: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }],
          responseMime: 'text/plain',
          initiator: 'script',
        }),
      ),
    ).toEqual({
      kind: 'fetch-xhr',
      confidence: 'likely',
      evidence: [
        'Request header X-Requested-With reports XMLHttpRequest.',
        'HAR initiator type is script.',
      ],
    });
  });

  it('labels JSON traffic as a REST-like API without claiming REST proof', () => {
    expect(
      classifyRequest(requestWith({ responseMime: 'application/problem+json' })),
    ).toEqual({
      kind: 'api',
      confidence: 'likely',
      evidence: ['Response MIME type is application/problem+json.'],
    });
  });

  it('returns unknown when browser evidence does not support a protocol kind', () => {
    expect(classifyRequest(requestWith({ responseMime: 'text/plain' }))).toEqual({
      kind: 'unknown',
      confidence: 'unknown',
      evidence: [],
    });
  });

  it('fails safely for a malformed URL while retaining MIME evidence', () => {
    expect(
      classifyRequest(
        requestWith({
          url: 'not a URL',
          responseMime: 'application/json',
        }),
      ),
    ).toEqual({
      kind: 'api',
      confidence: 'likely',
      evidence: ['Response MIME type is application/json.'],
    });
  });

  it('returns a deeply immutable classification graph', () => {
    const result = classifyRequest(requestWith({ url: 'https://app.test/api/items' }));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });
});
