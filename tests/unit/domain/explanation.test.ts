import { describe, expect, it } from 'vitest';

import { explainRequest } from '../../../src/domain/explanation';
import { requestWith } from '../../helpers/request-factory';

describe('explainRequest', () => {
  it('states trigger, protocol, success status, and duration deterministically', () => {
    const explanation = explainRequest(
      requestWith({
        method: 'POST',
        initiator: 'Save profile',
        requestHeaders: [{ name: 'Next-Action', value: '40f3a8b1' }],
        responseMime: 'text/x-component',
        responseStatus: 201,
        durationMs: 48,
      }),
      [],
    );

    expect(explanation).toEqual({
      outcome: 'success',
      summary:
        'Save profile triggered a Server Action request. It completed with HTTP 201 (success) in 48 ms.',
      guidance: [],
      evidence: [
        'Initiator: Save profile.',
        'Classification: Server Action (confirmed).',
        'HTTP status: 201.',
        'Duration: 48 ms.',
      ],
    });
    expect(JSON.stringify(explanation)).not.toContain('function name');
  });

  it('explains a failed Server Action without interpreting its opaque identifier', () => {
    const explanation = explainRequest(
      requestWith({
        method: 'POST',
        requestHeaders: [{ name: 'Next-Action', value: 'opaque-id' }],
        responseMime: 'text/x-component',
        responseStatus: 503,
        durationMs: 75,
      }),
      [],
    );

    expect(explanation.outcome).toBe('server-error');
    expect(explanation.summary).toContain('HTTP 503 (server error)');
    expect(explanation.guidance).toContain(
      'Inspect server logs and the response body for the server failure.',
    );
    expect(JSON.stringify(explanation)).not.toContain('opaque-id');
  });

  it('reports direct redirect, cache, and service-worker facts', () => {
    const explanation = explainRequest(
      requestWith({
        responseStatus: 302,
        redirectUrl: 'https://app.test/login',
        fromCache: true,
        fromServiceWorker: true,
      }),
      [],
    );

    expect(explanation.outcome).toBe('redirect');
    expect(explanation.summary).toContain(
      'The response redirects to https://app.test/login.',
    );
    expect(explanation.summary).toContain(
      'The response was served from browser cache.',
    );
    expect(explanation.summary).toContain('A service worker supplied the response.');
    expect(explanation.evidence).toEqual(
      expect.arrayContaining([
        'Redirect target: https://app.test/login.',
        'Cache evidence: browser cache.',
        'Service worker evidence: response fetched via service worker.',
      ]),
    );
  });

  it('keeps a status-zero failure ambiguous without direct CORS or CSP evidence', () => {
    const explanation = explainRequest(
      requestWith({
        responseStatus: 0,
        responseBody: {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'content-not-retrieved',
        },
      }),
      [],
    );

    expect(explanation.outcome).toBe('no-http-response');
    expect(explanation.summary).toContain(
      'It failed before an HTTP response was captured',
    );
    expect(JSON.stringify(explanation)).not.toMatch(/CORS|CSP|retry/i);
    expect(explanation.guidance).toContain(
      'Check the browser Network panel and server logs; no HTTP response was captured.',
    );
  });

  it('names CORS only when the captured failure reason says CORS', () => {
    const explanation = explainRequest(
      requestWith({
        responseStatus: 0,
        responseBody: {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'CORS policy blocked the response',
        },
      }),
      [],
    );

    expect(explanation.summary).toContain(
      'Direct capture evidence reports a CORS failure.',
    );
    expect(explanation.guidance).toContain(
      'Inspect the response CORS headers and the requesting origin.',
    );
    expect(explanation.evidence).toContain(
      'CORS evidence: response body reason reports CORS.',
    );
  });

  it('names CSP only when the captured failure reason says CSP', () => {
    const explanation = explainRequest(
      requestWith({
        responseStatus: 0,
        responseBody: {
          state: 'unavailable',
          size: 0,
          capturedSize: 0,
          reason: 'blocked-by-csp',
        },
      }),
      [],
    );

    expect(explanation.summary).toContain(
      'Direct capture evidence reports a CSP failure.',
    );
    expect(explanation.guidance).toContain(
      'Inspect the active Content-Security-Policy and blocked resource type.',
    );
    expect(explanation.evidence).toContain(
      'CSP evidence: response body reason reports CSP.',
    );
  });

  it('calls matching traffic a repeated call, not a retry', () => {
    const request = requestWith({
      id: 'current',
      method: 'GET',
      url: 'https://app.test/items?b=2&a=1#row',
    });
    const related = requestWith({
      id: 'earlier',
      method: 'get',
      url: 'https://app.test/items?a=1&b=2',
    });
    const explanation = explainRequest(request, [request, related]);

    expect(explanation.summary).toContain(
      '1 related request has the same method and normalized URL; this is a repeated call, not proof of a retry.',
    );
    expect(explanation.evidence).toContain('Repeated call count: 1.');
    expect(explanation.guidance).toContain(
      'Compare the repeated calls to find changed headers, bodies, or timing.',
    );
  });

  it('uses retry wording only for a direct request retry header', () => {
    const explanation = explainRequest(
      requestWith({
        requestHeaders: [{ name: 'X-Retry-Attempt', value: '2' }],
      }),
      [],
    );

    expect(explanation.summary).toContain(
      'Request header X-Retry-Attempt directly identifies retry attempt 2.',
    );
    expect(explanation.evidence).toContain('Retry evidence: X-Retry-Attempt=2.');
  });

  it('adds client-error and slow-call guidance from direct status and timing', () => {
    const explanation = explainRequest(
      requestWith({ responseStatus: 404, durationMs: 1_500 }),
      [],
    );

    expect(explanation.outcome).toBe('client-error');
    expect(explanation.guidance).toEqual([
      'Check the request URL, parameters, and authorization for the client error.',
      'Inspect the timing breakdown; this request took at least one second.',
    ]);
  });

  it('retains an uncommon HTTP response without inventing an error class', () => {
    const explanation = explainRequest(requestWith({ responseStatus: 101 }), []);

    expect(explanation).toMatchObject({
      outcome: 'http-response',
      summary:
        'The browser triggered an unknown request. It completed with HTTP 101 in 20 ms.',
    });
  });

  it('does not count a different method, route, or malformed URL as repeated', () => {
    const explanation = explainRequest(
      requestWith({ id: 'current', url: 'not a URL', method: 'POST' }),
      [
        requestWith({ id: 'one', url: 'not a URL', method: 'GET' }),
        requestWith({ id: 'two', url: 'another malformed URL', method: 'POST' }),
      ],
    );

    expect(JSON.stringify(explanation)).not.toContain('repeated call');
  });

  it('returns a deeply immutable explanation graph', () => {
    const explanation = explainRequest(requestWith(), []);

    expect(Object.isFrozen(explanation)).toBe(true);
    expect(Object.isFrozen(explanation.guidance)).toBe(true);
    expect(Object.isFrozen(explanation.evidence)).toBe(true);
  });
});
