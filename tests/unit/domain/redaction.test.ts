import { describe, expect, it } from 'vitest';

import type { BodyContent, CapturedRequest, Header } from '../../../src/domain/model';
import {
  DEFAULT_REDACTION_CONFIG,
  REDACTED,
  redactBody,
  redactHeaders,
  redactRequest,
  redactUnknown,
  redactUrl,
} from '../../../src/domain/redaction';

function requestFixture(
  overrides: Partial<{
    url: string;
    requestHeaders: readonly Header[];
    requestBody: BodyContent;
  }> = {},
): CapturedRequest {
  return {
    id: 'request-1',
    url: overrides.url ?? 'https://api.test/items?page=2',
    method: 'POST',
    startedAt: 1_000,
    request: {
      headers: overrides.requestHeaders ?? [],
      ...(overrides.requestBody === undefined ? {} : { body: overrides.requestBody }),
    },
    response: {
      status: 200,
      headers: [],
      body: {
        state: 'available',
        size: 2,
        capturedSize: 2,
        text: '{}',
        mimeType: 'application/json',
      },
    },
    timing: { totalMs: 12 },
    evidence: {},
  };
}

function requestWithHeader(name: string, value: string): CapturedRequest {
  return requestFixture({ requestHeaders: [{ name, value }] });
}

function requestWithJson(value: unknown): CapturedRequest {
  const text = JSON.stringify(value);
  return requestFixture({
    requestBody: {
      state: 'available',
      size: text.length,
      capturedSize: text.length,
      text,
      mimeType: 'application/json',
    },
  });
}

function requestWithUrl(url: string): CapturedRequest {
  return requestFixture({ url });
}

describe('redactRequest', () => {
  it.each([
    [
      'authorization header',
      requestWithHeader('Authorization', 'Bearer abc.def.ghi'),
      /abc\.def\.ghi/,
    ],
    [
      'nested JSON',
      requestWithJson({
        user: { password: 'hunter2', safe: 'visible' },
      }),
      /hunter2/,
    ],
    [
      'query token',
      requestWithUrl('https://api.test/items?token=secret&page=2'),
      /secret/,
    ],
    [
      'GraphQL variables',
      requestWithJson({
        query: 'query X',
        variables: { apiKey: 'sk-live-1' },
      }),
      /sk-live-1/,
    ],
  ])('removes %s before returning a record', (_name, request, secret) => {
    const result = redactRequest(request, DEFAULT_REDACTION_CONFIG);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(secret);
    expect(serialized).toContain(REDACTED);
  });

  it('returns a safe immutable copy for serialization and structured cloning', () => {
    const request = requestWithJson({
      password: 'hunter2',
      nested: [{ safe: 'visible', csrf_token: 'csrf-secret' }],
    });
    const before = JSON.stringify(request);

    const result = redactRequest(request, DEFAULT_REDACTION_CONFIG);
    const serialized = JSON.stringify(result);
    const cloned = structuredClone(result);

    expect(serialized).not.toMatch(/hunter2|csrf-secret/);
    expect(cloned.request.body?.text).toContain(`"password":"${REDACTED}"`);
    expect(cloned.request.body?.text).toContain(`"csrf_token":"${REDACTED}"`);
    expect(cloned.request.body?.text).toContain('"safe":"visible"');
    expect(JSON.stringify(request)).toBe(before);
    expect(result).not.toBe(request);
    expect(result.request).not.toBe(request.request);
  });

  it('never invokes getters or mutates prototypes while traversing hostile input', () => {
    let getterCalls = 0;
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(value, {
      token: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('leak');
        },
      },
      safe: { enumerable: true, value: 'visible' },
      __proto__: {
        enumerable: true,
        value: { polluted: true },
      },
    });

    const result = redactUnknown(value, DEFAULT_REDACTION_CONFIG) as Record<
      string,
      unknown
    >;

    expect(getterCalls).toBe(0);
    expect(result.token).toBe(REDACTED);
    expect(result.safe).toBe('visible');
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('terminates cycles and depth overflow with redacted markers', () => {
    const cyclic: { safe: string; self?: unknown } = { safe: 'visible' };
    cyclic.self = cyclic;
    let deep: unknown = 'bottom-secret';
    for (let index = 0; index < 40; index += 1) {
      deep = { child: deep };
    }

    const result = redactUnknown({ cyclic, deep }, DEFAULT_REDACTION_CONFIG);
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('"safe":"visible"');
    expect(serialized).toContain(REDACTED);
    expect(serialized).not.toContain('bottom-secret');
  });

  it('stops after 10,000 keys without leaking unvisited values', () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < 10_001; index += 1) {
      Object.defineProperty(hostile, `safe${index}`, {
        enumerable: true,
        value: index === 10_000 ? 'tail-secret' : index,
      });
    }

    const result = redactUnknown(hostile, DEFAULT_REDACTION_CONFIG) as Record<
      string,
      unknown
    >;

    expect(Object.keys(result)).toHaveLength(10_000);
    expect(JSON.stringify(result)).not.toContain('tail-secret');
  });

  it('omits non-sensitive accessors and preserves nested arrays', () => {
    let getterCalls = 0;
    const value = {
      items: [{ safe: 'visible' }],
      get computed() {
        getterCalls += 1;
        return 'secret';
      },
    };

    expect(redactUnknown(value, DEFAULT_REDACTION_CONFIG)).toEqual({
      items: [{ safe: 'visible' }],
    });
    expect(getterCalls).toBe(0);
  });

  it('can disable value-pattern scanning without disabling field redaction', () => {
    const config = {
      ...DEFAULT_REDACTION_CONFIG,
      scanValuePatterns: false,
    };

    expect(
      redactUnknown(
        { note: 'Bearer visible-by-choice', token: 'always-secret' },
        config,
      ),
    ).toEqual({
      note: 'Bearer visible-by-choice',
      token: REDACTED,
    });
  });

  it('fails closed instead of scanning an unbounded string', () => {
    const huge = `safe-${'x'.repeat(1024 * 1024)}`;

    expect(redactUnknown(huge, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
  });

  it('fails closed when hostile descriptor traps throw', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('descriptor trap');
        },
      },
    );

    expect(() => redactUnknown(hostile, DEFAULT_REDACTION_CONFIG)).not.toThrow();
    expect(redactUnknown(hostile, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
  });

  it('returns a serializable safe record when request traversal fails', () => {
    const hostile = new Proxy(
      { rawSecret: 'request-secret' },
      {
        ownKeys: () => {
          throw new Error('descriptor trap');
        },
      },
    ) as unknown as CapturedRequest;

    const result = redactRequest(hostile, DEFAULT_REDACTION_CONFIG);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('request-secret');
    expect(serialized).toContain(REDACTED);
  });
});

describe('redaction helpers', () => {
  it('redacts mixed-case duplicate headers and scans safe-named values', () => {
    expect(
      redactHeaders(
        [
          { name: 'aUtHoRiZaTiOn', value: 'first' },
          { name: 'authorization', value: 'second' },
          { name: 'X-Trace', value: 'Bearer trace-secret' },
          { name: 'X-Safe', value: 'visible' },
        ],
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual([
      { name: 'aUtHoRiZaTiOn', value: REDACTED },
      { name: 'authorization', value: REDACTED },
      { name: 'X-Trace', value: REDACTED },
      { name: 'X-Safe', value: 'visible' },
    ]);
  });

  it('redacts compound sensitive names and common AWS key shapes', () => {
    expect(
      redactUnknown(
        {
          userPasswordConfirmation: 'hunter2',
          note: 'AKIAIOSFODNN7EXAMPLE',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual({
      userPasswordConfirmation: REDACTED,
      note: REDACTED,
    });
  });

  it('redacts URL query fields while preserving duplicates and formatting', () => {
    const result = redactUrl(
      'https://api.test/items?To_Ken=one&to-ken=two&page=2#result',
      DEFAULT_REDACTION_CONFIG,
    );
    const formatted = new URL(result);

    expect(formatted.searchParams.getAll('To_Ken')).toEqual([REDACTED]);
    expect(formatted.searchParams.getAll('to-ken')).toEqual([REDACTED]);
    expect(formatted.searchParams.get('page')).toBe('2');
    expect(formatted.hash).toBe('#result');
    expect(result).not.toMatch(/one|two/);
  });

  it('redacts URL credentials and supports relative URLs', () => {
    const credentialed = redactUrl(
      'https://user:password@api.test/items?page=2',
      DEFAULT_REDACTION_CONFIG,
    );
    const relative = redactUrl('/items?token=secret#result', DEFAULT_REDACTION_CONFIG);

    expect(credentialed).not.toMatch(/user|password/);
    expect(decodeURIComponent(new URL(credentialed).username)).toBe(REDACTED);
    expect(decodeURIComponent(new URL(credentialed).password)).toBe(REDACTED);
    expect(relative).toBe(`/items?token=${REDACTED}#result`);
  });

  it('fails closed for an unparseable URL containing a bearer token', () => {
    const result = redactUrl(
      'http://[invalid Bearer url-secret',
      DEFAULT_REDACTION_CONFIG,
    );

    expect(result).toBe(REDACTED);
  });

  it('redacts JSON, form, multipart, and plain-text patterns', () => {
    const cases: readonly [BodyContent, readonly string[]][] = [
      [
        {
          state: 'available',
          size: 48,
          capturedSize: 48,
          text: '{"items":[{"PASSWORD":"hunter2","safe":"visible"}]}',
          mimeType: 'application/json',
        },
        ['hunter2'],
      ],
      [
        {
          state: 'available',
          size: 34,
          capturedSize: 34,
          text: 'token=one&token=two&safe=visible',
          mimeType: 'application/x-www-form-urlencoded',
        },
        ['one', 'two'],
      ],
      [
        {
          state: 'available',
          size: 172,
          capturedSize: 172,
          text: [
            '--b',
            'Content-Disposition: form-data; name="api_key"',
            '',
            'multipart-secret',
            '--b',
            'Content-Disposition: form-data; name="safe"',
            '',
            'visible',
            '--b--',
            '',
          ].join('\r\n'),
          mimeType: 'multipart/form-data; boundary=b',
        },
        ['multipart-secret'],
      ],
      [
        {
          state: 'available',
          size: 27,
          capturedSize: 27,
          text: 'credential: Bearer live-123',
          mimeType: 'text/plain',
        },
        ['live-123'],
      ],
    ];

    for (const [body, secrets] of cases) {
      const result = redactBody(body, DEFAULT_REDACTION_CONFIG);
      const serialized = JSON.stringify(result);

      expect(serialized).toContain(REDACTED);
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
      }
      expect(body.text).not.toContain(REDACTED);
    }
  });

  it('honors normalized user-supplied field names', () => {
    const config = {
      ...DEFAULT_REDACTION_CONFIG,
      fieldNames: [...DEFAULT_REDACTION_CONFIG.fieldNames, 'Private Note'],
    };

    expect(
      redactUnknown({ private_note: 'custom-secret', safe: 'visible' }, config),
    ).toEqual({ private_note: REDACTED, safe: 'visible' });
  });

  it('redacts malformed JSON and multipart values by pattern fallback', () => {
    const malformedJson = redactBody(
      {
        state: 'available',
        size: 27,
        capturedSize: 27,
        text: '{"note":"Bearer json-secret"',
        mimeType: 'application/json',
      },
      DEFAULT_REDACTION_CONFIG,
    );
    const malformedMultipart = redactBody(
      {
        state: 'available',
        size: 34,
        capturedSize: 34,
        text: 'note=Bearer multipart-secret',
        mimeType: 'multipart/form-data',
      },
      DEFAULT_REDACTION_CONFIG,
    );

    expect(malformedJson.text).toBe(REDACTED);
    expect(malformedMultipart.text).toBe(REDACTED);
  });

  it('redacts LF multipart fields while preserving file parts', () => {
    const body: BodyContent = {
      state: 'available',
      size: 170,
      capturedSize: 170,
      text: [
        '--b',
        'Content-Disposition: form-data; name=token',
        '',
        'field-secret',
        '--b',
        'Content-Disposition: form-data; name=upload; filename=file.txt',
        '',
        'file-content',
        '--b--',
        '',
      ].join('\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toContain(`token\n\n${REDACTED}`);
    expect(result.text).toContain('file-content');
    expect(result.text).not.toContain('field-secret');
  });

  it('keeps unavailable bodies serializable without inventing text', () => {
    expect(
      redactBody(
        {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'not captured',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual({
      state: 'unavailable',
      size: 0,
      capturedSize: 0,
      reason: 'not captured',
    });
  });

  it('returns a serializable safe body when body traversal fails', () => {
    const hostile = new Proxy(
      { text: 'body-secret' },
      {
        ownKeys: () => {
          throw new Error('descriptor trap');
        },
      },
    ) as unknown as BodyContent;

    const result = redactBody(hostile, DEFAULT_REDACTION_CONFIG);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('body-secret');
    expect(result).toMatchObject({
      state: 'unavailable',
      reason: 'redaction-failed',
    });
  });

  it('redacts response cookies and response JSON before returning', () => {
    const request = requestFixture();
    const hostileResponse: CapturedRequest = {
      ...request,
      response: {
        ...request.response,
        headers: [{ name: 'Set-Cookie', value: 'session=secret' }],
        body: {
          state: 'available',
          size: 22,
          capturedSize: 22,
          text: '{"password":"secret"}',
          mimeType: 'application/json',
        },
      },
    };

    const result = redactRequest(hostileResponse, DEFAULT_REDACTION_CONFIG);

    expect(result.response.headers).toEqual([{ name: 'Set-Cookie', value: REDACTED }]);
    expect(result.response.body.text).toBe(`{"password":"${REDACTED}"}`);
  });

  it('does not throw on malformed URL or form encodings', () => {
    expect(() =>
      redactUrl('https://api.test/%E0%A4%A?token=%E0%A4%A', DEFAULT_REDACTION_CONFIG),
    ).not.toThrow();
    expect(() =>
      redactBody(
        {
          state: 'available',
          size: 18,
          capturedSize: 18,
          text: 'token=%E0%A4%A',
          mimeType: 'application/x-www-form-urlencoded',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).not.toThrow();
  });
});
