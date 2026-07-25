import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS } from '../../../src/domain/session';
import { normalizeObservation } from '../../../src/features/capture/normalize-har';
import { observation } from '../../helpers/har-factory';

describe('normalizeObservation', () => {
  it('normalizes timing, initiator, cache, service-worker, and redirect evidence', () => {
    const request = normalizeObservation(
      observation({
        response: {
          status: 302,
          redirectURL: 'https://app.test/final',
          _fetchedViaServiceWorker: true,
        },
        _fromCache: 'memory',
        _initiator: { type: 'script', url: 'https://app.test/app.js' },
        timings: { wait: 12, receive: 8 },
      }),
      DEFAULT_LIMITS,
    );

    expect(request).toMatchObject({
      response: { status: 302 },
      timing: { totalMs: 20, waitMs: 12, receiveMs: 8 },
      evidence: {
        fromCache: true,
        fromServiceWorker: true,
        redirectUrl: 'https://app.test/final',
        initiator: 'script',
      },
    });
  });

  it('preserves metadata when content retrieval fails', () => {
    const request = normalizeObservation(
      observation({ response: { content: { size: 99 } } }),
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toMatchObject({
      state: 'unavailable',
      size: 99,
      reason: 'content-not-retrieved',
    });
  });

  it('keeps duplicate headers, clamps invalid timings, and preserves status zero', () => {
    const request = normalizeObservation(
      observation({
        time: Number.NaN,
        response: {
          status: 0,
          headers: [
            { name: 'set-cookie', value: 'first=1' },
            { name: 'set-cookie', value: 'second=2' },
          ],
        },
        timings: { wait: -1, receive: Number.POSITIVE_INFINITY },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.response.status).toBe(0);
    expect(request.response.headers).toEqual([
      { name: 'set-cookie', value: 'first=1' },
      { name: 'set-cookie', value: 'second=2' },
    ]);
    expect(request.timing).toEqual({ totalMs: 0 });
  });

  it('copies only own data fields from unknown HAR objects', () => {
    const raw = observation().entry as Record<string, unknown>;
    Object.defineProperty(raw, 'request', {
      enumerable: true,
      get() {
        throw new Error('normalizer must not invoke Chrome getters');
      },
    });

    const request = normalizeObservation(
      { entry: raw, observedAt: 7 },
      DEFAULT_LIMITS,
      'req-own-fields',
    );

    expect(request).toMatchObject({
      id: 'req-own-fields',
      url: '',
      startedAt: 1_700_000_000_000,
      request: { headers: [] },
    });
  });

  it('normalizes available request text and preserves empty post bodies', () => {
    const request = normalizeObservation(
      observation({
        request: {
          method: 'POST',
          url: 'https://app.test/form',
          headers: [{ name: 'content-type', value: 'application/json' }],
          postData: { mimeType: 'application/json', text: '' },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request).toEqual({
      headers: [{ name: 'content-type', value: 'application/json' }],
      body: {
        state: 'available',
        size: 0,
        capturedSize: 0,
        text: '',
        mimeType: 'application/json',
      },
    });
  });

  it('normalizes explicit post-data params without inventing omitted values', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [
              { name: 'tag', value: 'one' },
              { name: 'tag', value: 'two' },
              { name: 'invalid' },
            ],
          },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body).toMatchObject({
      state: 'available',
      text: 'tag=one&tag=two',
      mimeType: 'application/x-www-form-urlencoded',
    });
  });

  it('uses response content MIME metadata to decode captured base64', () => {
    const request = normalizeObservation(
      {
        ...observation({
          response: { content: { mimeType: 'application/json', size: 2 } },
        }),
        content: { text: 'aGk=', encoding: 'base64' },
      },
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toEqual({
      state: 'available',
      size: 2,
      capturedSize: 2,
      text: 'hi',
      mimeType: 'application/json',
    });
  });

  it('returns a neutral DTO for malformed top-level HAR input', () => {
    const request = normalizeObservation(
      { entry: null, observedAt: Number.NaN },
      DEFAULT_LIMITS,
      'req-malformed',
    );

    expect(request).toEqual({
      id: 'req-malformed',
      url: '',
      method: 'GET',
      startedAt: 0,
      request: {
        headers: [],
        body: {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'content-not-retrieved',
        },
      },
      response: {
        status: 0,
        headers: [],
        body: {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'content-not-retrieved',
        },
      },
      timing: { totalMs: 0 },
      evidence: {},
    });
  });

  it('uses decoded content size before compressed transport body size', () => {
    const request = normalizeObservation(
      {
        ...observation({
          response: {
            bodySize: 3,
            content: { mimeType: 'text/plain', size: 8, compression: 5 },
          },
        }),
        content: { text: 'abcdefgh', encoding: '' },
      },
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toMatchObject({
      state: 'available',
      size: 8,
      capturedSize: 8,
      text: 'abcdefgh',
    });
  });

  it('uses transport body size only as fallback when response content is unavailable', () => {
    const request = normalizeObservation(
      observation({
        response: {
          bodySize: 99,
          content: { mimeType: 'application/json' },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toEqual({
      state: 'unavailable',
      size: 99,
      capturedSize: 0,
      reason: 'content-not-retrieved',
    });
  });

  it('sums retained timing components when HAR total time is invalid', () => {
    const request = normalizeObservation(
      observation({
        time: Number.NaN,
        timings: { blocked: -1, dns: 2, connect: 3, send: 4, wait: 5, receive: 6 },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.timing).toEqual({
      totalMs: 20,
      dnsMs: 2,
      connectMs: 3,
      sendMs: 4,
      waitMs: 5,
      receiveMs: 6,
    });
  });

  it('clamps an overflowing timing fallback to a finite total', () => {
    const request = normalizeObservation(
      observation({
        time: Number.NaN,
        timings: {
          dns: Number.MAX_VALUE,
          connect: Number.MAX_VALUE,
          send: 1,
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.timing).toEqual({
      totalMs: 0,
      dnsMs: Number.MAX_VALUE,
      connectMs: Number.MAX_VALUE,
      sendMs: 1,
    });
  });

  it('does not invoke header array getters or traverse beyond its item bound', () => {
    const headers = new Array<unknown>(10_001);
    Object.defineProperty(headers, '10000', {
      enumerable: true,
      get() {
        throw new Error('out-of-bound header read');
      },
    });

    const request = normalizeObservation(
      observation({ response: { headers } }),
      DEFAULT_LIMITS,
    );

    expect(request.response.headers).toEqual([]);
  });

  it('does not invoke post-data parameter getters', () => {
    const params = new Array<unknown>(1);
    Object.defineProperty(params, '0', {
      enumerable: true,
      get() {
        throw new Error('parameter getter invoked');
      },
    });

    const request = normalizeObservation(
      observation({ request: { postData: { params } } }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body).toMatchObject({ state: 'available', text: '' });
  });

  it('treats revoked array proxies as unavailable collections', () => {
    const headerProxy = Proxy.revocable([], {});
    const parameterProxy = Proxy.revocable([], {});
    headerProxy.revoke();
    parameterProxy.revoke();

    const request = normalizeObservation(
      observation({
        request: { postData: { params: parameterProxy.proxy } },
        response: { headers: headerProxy.proxy },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.response.headers).toEqual([]);
    expect(request.request.body).toMatchObject({ state: 'unavailable' });
  });

  it('deep-freezes the normalized graph without freezing raw HAR input', () => {
    const raw = observation({
      request: { headers: [{ name: 'accept', value: 'application/json' }] },
      response: { headers: [{ name: 'content-type', value: 'application/json' }] },
    });
    const request = normalizeObservation(raw, DEFAULT_LIMITS);

    expect(
      [
        request,
        request.request,
        request.request.headers,
        request.request.headers[0],
        request.request.body,
        request.response,
        request.response.headers,
        request.response.headers[0],
        request.response.body,
        request.timing,
        request.evidence,
      ].every((value) => Object.isFrozen(value)),
    ).toBe(true);
    expect(Object.isFrozen(raw.entry)).toBe(false);
  });

  it('rejects unsupported retrieved-content encodings', () => {
    const request = normalizeObservation(
      {
        ...observation(),
        content: { text: 'compressed', encoding: 'gzip' } as never,
      },
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toMatchObject({
      state: 'unavailable',
      reason: 'content-not-retrieved',
    });
  });

  it('bounds post-data parameter materialization before URL encoding', () => {
    const append = vi
      .spyOn(URLSearchParams.prototype, 'append')
      .mockImplementation((_name, value) => {
        if (value.length > 8) throw new Error('unbounded form allocation');
      });

    try {
      const request = normalizeObservation(
        observation({
          request: {
            postData: {
              params: [{ name: 'a', value: 'x'.repeat(1_024) }],
            },
          },
        }),
        { ...DEFAULT_LIMITS, maxBodyBytes: 8 },
      );

      expect(request.request.body).toEqual({
        state: 'truncated',
        size: 1_026,
        capturedSize: 8,
        text: 'a=xxxxxx',
        mimeType: 'application/x-www-form-urlencoded',
        reason: 'body-limit',
      });
    } finally {
      append.mockRestore();
    }
  });

  it('percent-encodes repeated form params without splitting encoded bytes', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [
              { name: 'a b', value: 'é~*' },
              { name: 'a b', value: 'x' },
            ],
          },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body).toMatchObject({
      state: 'available',
      size: 20,
      capturedSize: 20,
      text: 'a+b=%C3%A9%7E*&a+b=x',
    });
  });

  it('truncates form params only at complete percent-encoded code points', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [{ name: 'a', value: 'éé' }],
          },
        },
      }),
      { ...DEFAULT_LIMITS, maxBodyBytes: 8 },
    );

    expect(request.request.body).toEqual({
      state: 'truncated',
      size: 14,
      capturedSize: 8,
      text: 'a=%C3%A9',
      mimeType: 'application/x-www-form-urlencoded',
      reason: 'body-limit',
    });
  });

  it('does not retain a partial multi-byte form code point', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [{ name: 'a', value: 'é' }],
          },
        },
      }),
      { ...DEFAULT_LIMITS, maxBodyBytes: 5 },
    );

    expect(request.request.body).toEqual({
      state: 'truncated',
      size: 8,
      capturedSize: 2,
      text: 'a=',
      mimeType: 'application/x-www-form-urlencoded',
      reason: 'body-limit',
    });
  });

  it('encodes astral and unpaired-surrogate form values safely', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [{ name: 'a', value: '😀\ud800' }],
          },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body).toMatchObject({
      state: 'available',
      size: 23,
      capturedSize: 23,
      text: 'a=%F0%9F%98%80%EF%BF%BD',
    });
  });

  it('preserves bounded form text across internal output chunks', () => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            params: [{ name: 'a', value: 'x'.repeat(4_096) }],
          },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body).toMatchObject({
      state: 'available',
      size: 4_098,
      capturedSize: 4_098,
    });
    expect(request.request.body?.text).toHaveLength(4_098);
    expect(request.request.body?.text?.startsWith('a=')).toBe(true);
    expect(request.request.body?.text?.endsWith('xxxx')).toBe(true);
  });

  it.each([
    ['application/custom-form', 'application/custom-form'],
    ['', undefined],
  ])('normalizes explicit form MIME type %j', (mimeType, expected) => {
    const request = normalizeObservation(
      observation({
        request: {
          postData: {
            mimeType,
            params: [{ name: 'a', value: 'b' }],
          },
        },
      }),
      DEFAULT_LIMITS,
    );

    expect(request.request.body?.mimeType).toBe(expected);
  });

  it('normalizes streamed attachments with provider evidence intact', () => {
    const request = normalizeObservation(
      {
        ...observation({
          response: {
            content: { size: 55, mimeType: 'text/event-stream' },
          },
        }),
        content: {
          text: 'partial',
          encoding: 'base64',
          state: 'streamed',
          unavailableReason: 'capture-stopped',
        },
      },
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toEqual({
      state: 'streamed',
      size: 55,
      capturedSize: 0,
      mimeType: 'text/event-stream',
      reason: 'capture-stopped',
    });
  });

  it('treats retrieved-content attachments without text as unavailable', () => {
    const request = normalizeObservation(
      {
        ...observation(),
        content: { encoding: '' } as never,
      },
      DEFAULT_LIMITS,
    );

    expect(request.response.body).toMatchObject({
      state: 'unavailable',
      reason: 'content-not-retrieved',
    });
  });
});
