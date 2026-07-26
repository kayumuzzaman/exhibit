import { describe, expect, it } from 'vitest';

import type {
  BodyContent,
  CapturedRequest,
  Header,
  RecordingSession,
} from '../../../src/domain/model';
import {
  DEFAULT_REDACTION_CONFIG,
  REDACTED,
  redactBody,
  redactHeaders,
  redactRecoveredSession,
  redactRequest,
  redactSession,
  redactUnknown,
  redactUrl,
} from '../../../src/domain/redaction';
import { createSession } from '../../../src/domain/session';

function requestFixture(
  overrides: Partial<{
    id: string;
    url: string;
    requestHeaders: readonly Header[];
    requestBody: BodyContent;
  }> = {},
): CapturedRequest {
  return {
    id: overrides.id ?? 'request-1',
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

function redactJsonValue(value: unknown, config = DEFAULT_REDACTION_CONFIG): unknown {
  const text = JSON.stringify(value);
  const result = redactBody(
    {
      state: 'available',
      size: text.length,
      capturedSize: text.length,
      text,
      mimeType: 'application/json',
    },
    config,
  );
  return JSON.parse(result.text ?? 'null');
}

describe('redactRequest', () => {
  it('always reissues syntactically allowlisted raw-derived identifiers', () => {
    const result = redactRequest(
      requestFixture({ id: 'GET-orders-alice42' }),
      DEFAULT_REDACTION_CONFIG,
    );

    expect(result.id).toMatch(/^req-[a-z0-9-]+$/u);
    expect(result.id).not.toBe('GET-orders-alice42');
    expect(JSON.stringify(result)).not.toContain('GET-orders-alice42');
  });

  it('reissues session request IDs and remaps redirect parents', () => {
    const parent = requestFixture({ id: 'GET-orders-alice42' });
    const child: CapturedRequest = {
      ...requestFixture({ id: 'GET-orders-alice42-redirect' }),
      evidence: { redirectParentId: parent.id },
    };
    const session: RecordingSession = {
      ...createSession('tab-1', 'https://app.test', 1_000),
      requests: [parent, child],
    };

    const result = redactSession(session, DEFAULT_REDACTION_CONFIG);

    expect(result.requests[0]?.id).not.toBe(parent.id);
    expect(result.requests[1]?.id).not.toBe(child.id);
    expect(result.requests[1]?.evidence.redirectParentId).toBe(result.requests[0]?.id);
    expect(JSON.stringify(result.requests)).not.toMatch(
      /GET-orders-alice42(?:-redirect)?/u,
    );
  });

  it('remaps redirect parents while recovering stored sessions', () => {
    const parent = requestFixture({ id: 'GET-orders-alice42' });
    const child: CapturedRequest = {
      ...requestFixture({ id: 'GET-orders-alice42-redirect' }),
      evidence: { redirectParentId: parent.id },
    };
    const session: RecordingSession = {
      ...createSession('tab-1', 'https://app.test', 1_000),
      requests: [parent, child],
    };

    const result = redactRecoveredSession(session, DEFAULT_REDACTION_CONFIG);

    expect(result.requests[1]?.evidence.redirectParentId).toBe(result.requests[0]?.id);
  });

  it('reissues a non-opaque identifier before granting sanitized type', () => {
    const result = redactRequest(
      requestFixture({
        id: 'POST:https://app.test/save?token=id-secret',
      }),
      DEFAULT_REDACTION_CONFIG,
    );

    expect(result.id).toMatch(/^req-[a-z0-9-]+$/u);
    expect(result.id).not.toMatch(/POST|app\.test|id-secret/iu);
  });

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

  it('rejects hostile unknown objects without getters or prototype mutation', () => {
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

    const result = redactUnknown(value, DEFAULT_REDACTION_CONFIG);

    expect(getterCalls).toBe(0);
    expect(result).toBe(REDACTED);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('terminates cycles and depth overflow with redacted markers', () => {
    const cyclic: { safe: string; self?: unknown } = { safe: 'visible' };
    cyclic.self = cyclic;
    let deep: unknown = 'bottom-secret';
    for (let index = 0; index < 40; index += 1) {
      deep = { child: deep };
    }

    const request = {
      ...requestFixture(),
      hostile: { cyclic, deep },
    } as CapturedRequest;
    const result = redactRequest(request, DEFAULT_REDACTION_CONFIG);
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

    const result = redactJsonValue(hostile) as Record<string, unknown>;

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

    const request = {
      ...requestFixture(),
      extra: value,
    } as CapturedRequest;
    const result = redactRequest(
      request,
      DEFAULT_REDACTION_CONFIG,
    ) as unknown as CapturedRequest & { extra: { items: unknown } };

    expect(result.extra).toEqual({
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
      redactJsonValue(
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

  it('removes hostile serializer hooks and non-JSON primitives', () => {
    const closureSecret = 'closure-value-4711';
    const hostile = {
      safe: 'visible',
      nested: {
        toJSON: () => closureSecret,
        callable: () => closureSecret,
        symbol: Symbol(closureSecret),
        bigint: 9_007_199_254_740_993n,
      },
    };

    const request = {
      ...requestFixture(),
      hostile,
    } as CapturedRequest;
    const result = redactRequest(
      request,
      DEFAULT_REDACTION_CONFIG,
    ) as unknown as CapturedRequest & {
      hostile: { nested: Record<string, unknown> };
    };

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() => structuredClone(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain(closureSecret);
    expect(result.hostile.nested).toMatchObject({
      toJSON: REDACTED,
      callable: REDACTED,
      symbol: REDACTED,
      bigint: REDACTED,
    });
  });

  it('keeps the full redacted request safe to stringify and clone', () => {
    const closureSecret = 'request-closure-5823';
    const hostile = {
      ...requestFixture(),
      serializer: {
        toJSON: () => closureSecret,
        bigint: 12n,
      },
    } as CapturedRequest;

    const result = redactRequest(hostile, DEFAULT_REDACTION_CONFIG);

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() => structuredClone(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain(closureSecret);
  });

  it('fails closed for revoked Proxies at public boundaries', () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(() =>
      redactUnknown(revocable.proxy, DEFAULT_REDACTION_CONFIG),
    ).not.toThrow();
    expect(redactUnknown(revocable.proxy, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);

    const result = redactRequest(
      revocable.proxy as CapturedRequest,
      DEFAULT_REDACTION_CONFIG,
    );
    expect(JSON.stringify(result)).toContain('redaction-failed');
  });

  it('avoids side-effecting descriptor traps at the unknown boundary', () => {
    let descriptorCalls = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => ['safe'],
        getOwnPropertyDescriptor: () => {
          descriptorCalls += 1;
          throw new Error('side effect');
        },
      },
    );

    expect(redactUnknown(hostile, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
    expect(descriptorCalls).toBe(0);
  });

  it('does not reflect over arbitrary objects at the public unknown boundary', () => {
    let ownKeyCalls = 0;
    let prototypeCalls = 0;
    let descriptorCalls = 0;
    const hostile = new Proxy(
      { safe: 'visible' },
      {
        ownKeys: () => {
          ownKeyCalls += 1;
          return ['safe'];
        },
        getPrototypeOf: () => {
          prototypeCalls += 1;
          return Object.prototype;
        },
        getOwnPropertyDescriptor: () => {
          descriptorCalls += 1;
          return {
            enumerable: true,
            configurable: true,
            get value() {
              throw new Error('trap-return getter');
            },
          };
        },
      },
    );

    expect(redactUnknown(hostile, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
    expect({ ownKeyCalls, prototypeCalls, descriptorCalls }).toEqual({
      ownKeyCalls: 0,
      prototypeCalls: 0,
      descriptorCalls: 0,
    });
  });

  it('does not inspect plain-object descriptors at the public unknown boundary', () => {
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'safe', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'getter-value-6934';
      },
    });

    expect(redactUnknown(hostile, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
    expect(getterCalls).toBe(0);
  });

  it('rejects non-DTO object prototypes', () => {
    class HostileRecord {
      raw = 'class-value-8156';
    }

    expect(redactUnknown(new HostileRecord(), DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
    expect(redactUnknown(new Date(0), DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
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
      redactJsonValue(
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

  it('recognizes validated unsecured JWTs and modern secret-key shapes', () => {
    const unsecuredJwt = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjMifQ.';

    expect(
      redactJsonValue(
        {
          jwt: unsecuredJwt,
          modernKey: 'sk-proj-abc123XYZ',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual({
      jwt: REDACTED,
      modernKey: REDACTED,
    });
  });

  it('preserves domain-like values and non-sensitive name fragments', () => {
    expect(
      redactJsonValue(
        {
          homepage: 'www.example.com',
          secretary: 'visible',
          sessionDuration: 30,
          tokenizerModel: 'visible',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual({
      homepage: 'www.example.com',
      secretary: 'visible',
      sessionDuration: 30,
      tokenizerModel: 'visible',
    });
  });

  it('redacts boundary-aware API-key and session credential names', () => {
    expect(
      redactJsonValue(
        {
          clientApiKey: 'client-value-9267',
          userSessionId: 'session-value-0378',
        },
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toEqual({
      clientApiKey: REDACTED,
      userSessionId: REDACTED,
    });
  });

  it('redacts normalized credential suffixes without separator or case hints', () => {
    const value = {
      USERPASSWORD: 'upper-value-7045',
      userpassword: 'lower-value-8156',
      clientapikey: 'client-value-9267',
      userAPIKey: 'camel-value-0378',
    };
    const text = JSON.stringify(value);
    const result = redactBody(
      {
        state: 'available',
        size: text.length,
        capturedSize: text.length,
        text,
        mimeType: 'application/json',
      },
      DEFAULT_REDACTION_CONFIG,
    );

    expect(JSON.parse(result.text ?? '')).toEqual({
      USERPASSWORD: REDACTED,
      userpassword: REDACTED,
      clientapikey: REDACTED,
      userAPIKey: REDACTED,
    });
  });

  it('preserves obsession while redacting explicit session credential forms', () => {
    expect(
      redactJsonValue({
        obsession: 'visible',
        session: 'session-value-6035',
        userSessionId: 'id-value-7146',
        userSessionToken: 'token-value-8257',
        userSessionKey: 'key-value-9368',
      }),
    ).toEqual({
      obsession: 'visible',
      session: REDACTED,
      userSessionId: REDACTED,
      userSessionToken: REDACTED,
      userSessionKey: REDACTED,
    });
  });

  it('falls back to default names for malformed custom field settings', () => {
    const config = {
      ...DEFAULT_REDACTION_CONFIG,
      fieldNames: null,
    } as unknown as typeof DEFAULT_REDACTION_CONFIG;

    expect(
      redactJsonValue({ password: 'default-value-1489', safe: 'visible' }, config),
    ).toEqual({
      password: REDACTED,
      safe: 'visible',
    });
  });

  it('skips sparse, accessor, primitive, and incomplete headers', () => {
    let getterCalls = 0;
    const headers: unknown[] = [];
    headers.length = 2;
    Object.defineProperty(headers, '0', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return { name: 'Authorization', value: 'accessor-value-2590' };
      },
    });
    headers.push(null, 'primitive', { name: 'X-Incomplete' });
    headers.push({ name: 'X-Safe', value: 'visible' });

    expect(
      redactHeaders(headers as readonly Header[], DEFAULT_REDACTION_CONFIG),
    ).toEqual([{ name: 'X-Safe', value: 'visible' }]);
    expect(getterCalls).toBe(0);
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

  it.each([
    ['access token', '#access_token=secret-original'],
    ['password', '#password=secret-original'],
    ['session', '#session_id=secret-original'],
    ['bearer', '#Bearer%20secret-original'],
    ['encoded parameter', '#access_token%3Dsecret-original'],
    ['fragment route', '#/callback?token=secret-original'],
  ])('redacts %s credentials from URL fragments', (_name, fragment) => {
    const result = redactUrl(
      `https://app.test/callback${fragment}`,
      DEFAULT_REDACTION_CONFIG,
    );

    expect(result).not.toContain('secret-original');
    expect(new URL(result).hash).toContain(REDACTED);
  });

  it('preserves a safe URL anchor without changing its spelling', () => {
    expect(
      redactUrl(
        'https://app.test/docs?page=2#installation-guide',
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toBe('https://app.test/docs?page=2#installation-guide');
  });

  it.each([
    'data:text/plain,visible#access_token=secret-original',
    'mailto:user@example.test#password=secret-original',
  ])('fails closed for opaque URL form %s', (value) => {
    expect(redactUrl(value, DEFAULT_REDACTION_CONFIG)).toBe(REDACTED);
  });

  it.each([
    'blob:https://app.test/token=secret-original',
    'BLOB:https://app.test/password=secret-original',
    'filesystem:https://app.test/temporary/session=secret-original',
    'chrome-extension://abcdefghijklmnop/token=secret-original',
    'javascript:credential=secret-original',
    'custom://app.test/api-key=secret-original',
  ])('fails closed for unsupported scheme URL %s', (value) => {
    const result = redactUrl(value, DEFAULT_REDACTION_CONFIG);

    expect(result).toBe(REDACTED);
    expect(result).not.toContain('secret-original');
  });

  it('fails closed for unsupported schemes even without a recognized secret', () => {
    expect(
      redactUrl('blob:https://app.test/safe-resource', DEFAULT_REDACTION_CONFIG),
    ).toBe(REDACTED);
  });

  it('normalizes scheme casing while preserving safe HTTP evidence', () => {
    expect(
      redactUrl(
        'HTTPs://APP.TEST/docs?page=2#installation-guide',
        DEFAULT_REDACTION_CONFIG,
      ),
    ).toBe('https://app.test/docs?page=2#installation-guide');
    expect(redactUrl('HTTP://APP.TEST/items?page=2', DEFAULT_REDACTION_CONFIG)).toBe(
      'http://app.test/items?page=2',
    );
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

  it('fails closed for an unparseable URL with an arbitrary secret', () => {
    const result = redactUrl(
      'http://[invalid/arbitrary-value-4711',
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
      redactJsonValue({ private_note: 'custom-secret', safe: 'visible' }, config),
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

  it('fails closed for malformed structured bodies with arbitrary secrets', () => {
    const cases: readonly BodyContent[] = [
      {
        state: 'available',
        size: 31,
        capturedSize: 31,
        text: '{"safe":"arbitrary-json-4711"',
        mimeType: 'application/json',
      },
      {
        state: 'available',
        size: 24,
        capturedSize: 24,
        text: 'arbitrary-multipart-5823',
        mimeType: 'multipart/form-data',
      },
      {
        state: 'available',
        size: 67,
        capturedSize: 67,
        text: [
          '--b',
          'X-Unrecognized: value',
          '',
          'arbitrary-part-6934',
          '--b--',
          '',
        ].join('\r\n'),
        mimeType: 'multipart/form-data; boundary=b',
      },
      {
        state: 'available',
        size: 130,
        capturedSize: 130,
        text: [
          '--b',
          'Content-Disposition: form-data; name="upload"; filename="safe.txt"',
          '',
          'arbitrary-file-7045',
          '--b--',
          '',
        ].join('\r\n'),
        mimeType: 'multipart/form-data; boundary=b',
      },
    ];

    for (const body of cases) {
      const result = redactBody(body, DEFAULT_REDACTION_CONFIG);
      expect(result.text).toContain(REDACTED);
      expect(result.text).not.toMatch(/arbitrary-(?:json|multipart|part|file)-\d+/u);
    }
  });

  it('fails closed for malformed multipart disposition parameters', () => {
    const body: BodyContent = {
      state: 'available',
      size: 80,
      capturedSize: 80,
      text: [
        '--b',
        'Content-Disposition: form-data; name',
        '',
        'malformed-value-3601',
        '--b--',
        '',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; ignored=value; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toContain(REDACTED);
    expect(result.text).not.toContain('malformed-value-3601');
  });

  it('discards a forged multipart preamble before the opening boundary', () => {
    const body: BodyContent = {
      state: 'available',
      size: 180,
      capturedSize: 180,
      text: [
        'Content-Disposition: form-data; name=safe',
        '',
        'preamble-value-1489',
        '--b',
        'Content-Disposition: form-data; name=safe',
        '',
        'visible',
        '--b--',
        '',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).not.toContain('preamble-value-1489');
    expect(result.text).toContain('visible');
  });

  it('fails closed when multipart content has no closing delimiter', () => {
    const body: BodyContent = {
      state: 'available',
      size: 90,
      capturedSize: 90,
      text: [
        '--b',
        'Content-Disposition: form-data; name=safe',
        '',
        'unclosed-value-2590',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toBe(REDACTED);
  });

  it('preserves inline boundary text inside a safe multipart field value', () => {
    const body: BodyContent = {
      state: 'available',
      size: 100,
      capturedSize: 100,
      text: [
        '--b',
        'Content-Disposition: form-data; name=notes',
        '',
        'notes --b text',
        '--b--',
        '',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toContain('notes --b text');
    expect(result.text).not.toBe(REDACTED);
  });

  it('fails closed for an inline multipart boundary with arbitrary data', () => {
    const body: BodyContent = {
      state: 'available',
      size: 120,
      capturedSize: 120,
      text: [
        'inline-prefix--b',
        'Content-Disposition: form-data; name=safe',
        '',
        'inline-value-0479',
        '--b--',
        '',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toBe(REDACTED);
    expect(result.text).not.toContain('inline-value-0479');
  });

  it('fails closed for garbage after a multipart closing delimiter', () => {
    const body: BodyContent = {
      state: 'available',
      size: 120,
      capturedSize: 120,
      text: [
        '--b',
        'Content-Disposition: form-data; name=safe',
        '',
        'visible',
        '--b--garbage-value-1580',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, DEFAULT_REDACTION_CONFIG);

    expect(result.text).toBe(REDACTED);
    expect(result.text).not.toContain('garbage-value-1580');
  });

  it('canonicalizes and redacts multipart names containing spaces', () => {
    const config = {
      ...DEFAULT_REDACTION_CONFIG,
      fieldNames: [...DEFAULT_REDACTION_CONFIG.fieldNames, 'Private Note'],
    };
    const body: BodyContent = {
      state: 'available',
      size: 90,
      capturedSize: 90,
      text: [
        '--b',
        'Content-Disposition: form-data; name="Private Note"',
        '',
        'private-value-4712',
        '--b--',
        '',
      ].join('\r\n'),
      mimeType: 'multipart/form-data; boundary=b',
    };

    const result = redactBody(body, config);

    expect(result.text).toContain('name="Private Note"');
    expect(result.text).toContain(REDACTED);
    expect(result.text).not.toContain('private-value-4712');
  });

  it('uses safe plain-text handling when body MIME metadata is absent', () => {
    const result = redactBody(
      {
        state: 'available',
        size: 25,
        capturedSize: 25,
        text: 'Bearer no-mime-value-5823',
      },
      DEFAULT_REDACTION_CONFIG,
    );

    expect(result.text).toBe(REDACTED);
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
    expect(result.text).toContain(`filename="${REDACTED}"`);
    expect(result.text).not.toContain('file-content');
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
