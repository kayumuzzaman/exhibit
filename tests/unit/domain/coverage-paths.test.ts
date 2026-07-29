import { describe, expect, it } from 'vitest';

import { withRecoveredAnalysis } from '../../../src/domain/analysis';
import { explainRequest } from '../../../src/domain/explanation';
import { sortedSafeHeaders, toSafeCurl } from '../../../src/domain/curl';
import { toSanitizedHar } from '../../../src/domain/har-export';
import { DEFAULT_REDACTION_CONFIG, redactSession } from '../../../src/domain/redaction';
import { toQaReport } from '../../../src/domain/report-export';
import { freezeSession } from '../../../src/domain/ring-buffer';
import type {
  SanitizedCapturedRequest,
  SanitizedRecordingSession,
} from '../../../src/domain/sanitized';
import { createSession } from '../../../src/domain/session';
import { applyBodyPolicy } from '../../../src/features/capture/body-policy';
import { filterRequests } from '../../../src/features/session/filter-requests';
import { SearchIndex } from '../../../src/features/session/search-index';
import { sanitizedRequestWith } from '../../helpers/request-factory';

function sessionWith(
  requests: readonly SanitizedCapturedRequest[],
  overrides: Partial<SanitizedRecordingSession> = {},
): SanitizedRecordingSession {
  const base = redactSession(
    createSession('tab-1', 'https://app.test', 1_000),
    DEFAULT_REDACTION_CONFIG,
  );
  return freezeSession({ ...base, ...overrides, requests: [...requests] });
}

describe('recovered analysis', () => {
  it('falls back to an unknown classification when analysis throws', () => {
    const broken = {
      ...sanitizedRequestWith(),
      response: null,
    } as unknown as SanitizedCapturedRequest;

    const recovered = withRecoveredAnalysis(
      sessionWith([]) as SanitizedRecordingSession,
    );
    const analyzed = withRecoveredAnalysis({
      ...recovered,
      requests: [broken],
    } as SanitizedRecordingSession);

    expect(analyzed.requests[0]?.classification?.kind).toBe('unknown');
    expect(analyzed.requests[0]?.explanation?.summary).toBe(
      'Request analysis was unavailable.',
    );
  });

  it('falls back to an unknown explanation when only explanation throws', () => {
    const broken = {
      ...sanitizedRequestWith({
        url: 'https://app.test/api/items',
        responseMime: 'application/json',
        responseText: '{"ok":true}',
      }),
      timing: null,
    } as unknown as SanitizedCapturedRequest;

    const analyzed = withRecoveredAnalysis({
      ...sessionWith([]),
      requests: [broken],
    } as SanitizedRecordingSession);

    expect(analyzed.requests[0]?.classification?.kind).toBe('api');
    expect(analyzed.requests[0]?.explanation?.outcome).toBe('unknown');
  });
});

describe('safe cURL header ordering', () => {
  it('breaks ties by original casing, value, then capture order', () => {
    const sorted = sortedSafeHeaders([
      { name: 'Accept', value: 'b' },
      { name: 'accept', value: 'a' },
      { name: 'Accept', value: 'a' },
      { name: 'authorization', value: 'Bearer x' },
    ]);

    expect(sorted).toEqual([
      { name: 'Accept', value: 'a' },
      { name: 'Accept', value: 'b' },
      { name: 'accept', value: 'a' },
    ]);
  });

  it('omits credential headers from the generated command', () => {
    const command = toSafeCurl({
      ...sanitizedRequestWith(),
      request: {
        headers: [
          { name: 'x-api-key', value: 'secret' },
          { name: 'accept', value: 'application/json' },
        ],
      },
    } as SanitizedCapturedRequest);

    expect(command).toContain('accept: application/json');
    expect(command).not.toContain('x-api-key');
  });
});

describe('export boundaries', () => {
  it('normalizes unusable session timestamps in the HAR export', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([sanitizedRequestWith()], {
          startedAt: Number.NaN,
          stoppedAt: Number.POSITIVE_INFINITY,
        }),
      ),
    ) as { log: { _exhibit: { startedAt: string; stoppedAt: string } } };

    expect(har.log._exhibit.startedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(har.log._exhibit.stoppedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps null session timestamps null in the HAR export', () => {
    const har = JSON.parse(toSanitizedHar(sessionWith([sanitizedRequestWith()]))) as {
      log: { _exhibit: { startedAt: null; stoppedAt: null } };
    };

    expect(har.log._exhibit.startedAt).toBeNull();
    expect(har.log._exhibit.stoppedAt).toBeNull();
  });

  it('escapes markdown control characters and unusable times in the QA report', () => {
    const request = {
      ...sanitizedRequestWith(),
      url: 'https://app.test/api/*_report_[1]',
      startedAt: Number.NaN,
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([request], { startedAt: Number.NaN }));

    expect(report).toContain('\\*');
    expect(report).toContain('Unavailable');
  });

  it('reports truncated request and response bodies in the QA report', () => {
    const truncated = {
      ...sanitizedRequestWith(),
      request: {
        headers: [],
        body: {
          state: 'truncated' as const,
          size: 50,
          capturedSize: 10,
          text: 'partial',
        },
      },
      response: {
        status: 200,
        headers: [],
        body: {
          state: 'truncated' as const,
          size: 90,
          capturedSize: 20,
          text: 'partial',
        },
      },
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([truncated]));

    expect(report).toContain('request body truncated (10 of 50 bytes captured)');
    expect(report).toContain('response body truncated (20 of 90 bytes captured)');
  });
});

describe('body policy measurement', () => {
  it('measures two-byte and four-byte characters against the limit', () => {
    const result = applyBodyPolicy(
      { text: 'é😀', encoding: '', mimeType: 'text/plain' },
      0,
      1_024,
    );

    expect(result.state).toBe('available');
    expect(result.size).toBe(6);
  });

  it('treats a lone surrogate as a three-byte replacement instead of failing', () => {
    const result = applyBodyPolicy(
      { text: `a\uD800b`, encoding: '', mimeType: 'text/plain' },
      0,
      1_024,
    );

    expect(result.size).toBe(5);
  });

  it('keeps the declared size when content is reported unavailable', () => {
    const result = applyBodyPolicy(
      { text: '', encoding: '', state: 'unavailable' },
      512,
      1_024,
    );

    expect(result).toMatchObject({
      state: 'unavailable',
      size: 512,
      reason: 'content-api-unavailable',
    });
  });
});

describe('remaining filter and index branches', () => {
  it('selects redirect outcomes only', () => {
    const redirected = {
      ...sanitizedRequestWith(),
      id: 'redirected',
      response: {
        status: 302,
        headers: [],
        body: { state: 'available' as const, size: 0, capturedSize: 0, text: '' },
      },
    } as SanitizedCapturedRequest;
    const succeeded = { ...sanitizedRequestWith(), id: 'ok' };

    expect(
      filterRequests([redirected, succeeded], {
        apiOnly: false,
        outcome: 'redirect',
      }).map(({ id }) => id),
    ).toEqual(['redirected']);
  });

  it('orders records with unusable start times after the rest', () => {
    const index = new SearchIndex();
    const later = { ...sanitizedRequestWith(), id: 'later', startedAt: 5_000 };
    const undated = {
      ...sanitizedRequestWith(),
      id: 'undated',
      startedAt: Number.NaN,
    } as SanitizedCapturedRequest;
    const earlier = { ...sanitizedRequestWith(), id: 'earlier', startedAt: 1_000 };

    for (const request of [undated, later, earlier]) index.add(request);

    expect(index.query('app.test').map(({ id }) => id)).toEqual([
      'earlier',
      'later',
      'undated',
    ]);
  });

  it('indexes a record that carries no request body', () => {
    const index = new SearchIndex();
    const noBody = {
      ...sanitizedRequestWith(),
      id: 'no-body',
      request: { headers: [] },
    } as SanitizedCapturedRequest;

    index.add(noBody);

    expect(index.query('app.test').map(({ id }) => id)).toEqual(['no-body']);
  });
});

describe('export ordering and parsing boundaries', () => {
  it('sorts query parameters by name, value, then original position', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([
          {
            ...sanitizedRequestWith(),
            url: 'https://app.test/api?b=2&a=2&a=1&a=1',
          } as SanitizedCapturedRequest,
        ]),
      ),
    ) as {
      log: {
        entries: { request: { queryString: { name: string; value: string }[] } }[];
      };
    };

    expect(har.log.entries[0]?.request.queryString).toEqual([
      { name: 'a', value: '1' },
      { name: 'a', value: '1' },
      { name: 'a', value: '2' },
      { name: 'b', value: '2' },
    ]);
  });

  it('emits an empty query list for an unparsable URL', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([
          {
            ...sanitizedRequestWith(),
            url: 'exhibit-opaque',
          } as SanitizedCapturedRequest,
        ]),
      ),
    ) as { log: { entries: { request: { queryString: unknown[] } }[] } };

    expect(har.log.entries[0]?.request.queryString).toEqual([]);
  });

  it('normalizes an unusable request timestamp to the epoch', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([
          {
            ...sanitizedRequestWith(),
            startedAt: Number.NaN,
          } as SanitizedCapturedRequest,
        ]),
      ),
    ) as { log: { entries: { startedDateTime: string }[] } };

    expect(har.log.entries[0]?.startedDateTime).toBe('1970-01-01T00:00:00.000Z');
  });

  it('refuses a request timestamp the Date API cannot represent', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([
          {
            ...sanitizedRequestWith(),
            startedAt: 9e15,
          } as SanitizedCapturedRequest,
        ]),
      ),
    ) as { log: { entries: { startedDateTime: string }[] } };

    expect(har.log.entries[0]?.startedDateTime).toBe('1970-01-01T00:00:00.000Z');
  });

  it('orders entries by start time and keeps undated records last in capture order', () => {
    const first = {
      ...sanitizedRequestWith(),
      id: 'first',
      startedAt: 1_000,
    } as SanitizedCapturedRequest;
    const second = {
      ...sanitizedRequestWith(),
      id: 'second',
      startedAt: 2_000,
    } as SanitizedCapturedRequest;
    const undatedA = {
      ...sanitizedRequestWith(),
      id: 'undated-a',
      startedAt: Number.NaN,
    } as SanitizedCapturedRequest;
    const undatedB = {
      ...sanitizedRequestWith(),
      id: 'undated-b',
      startedAt: Number.NaN,
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([undatedA, second, undatedB, first]));
    const firstDated = report.indexOf('1970-01-01T00:00:01.000Z');
    const secondDated = report.indexOf('1970-01-01T00:00:02.000Z');
    const undated = report.indexOf('Unavailable — HTTP');

    expect(firstDated).toBeGreaterThan(-1);
    expect(secondDated).toBeGreaterThan(firstDated);
    expect(undated).toBeGreaterThan(secondDated);
  });

  it('groups repeated calls that share a method and URL', () => {
    const repeated = ['one', 'two'].map(
      (id) =>
        ({
          ...sanitizedRequestWith(),
          id,
          url: 'https://app.test/api/items',
          startedAt: 1_000,
        }) as SanitizedCapturedRequest,
    );
    const other = {
      ...sanitizedRequestWith(),
      id: 'other',
      url: 'https://app.test/api/other',
      startedAt: 1_000,
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([...repeated, other]));

    expect(report).toContain('/api/items');
  });

  it('marks slow calls in the QA report', () => {
    const slow = {
      ...sanitizedRequestWith(),
      id: 'slow',
      timing: { totalMs: 5_000 },
    } as SanitizedCapturedRequest;

    expect(toQaReport(sessionWith([slow]))).toMatch(/slow/iu);
  });
});

describe('HAR and report shape boundaries', () => {
  it('defaults a missing request body MIME type and omits non-textual bodies', () => {
    const withoutMime = {
      ...sanitizedRequestWith(),
      id: 'no-mime',
      request: {
        headers: [],
        body: { state: 'available' as const, size: 4, capturedSize: 4, text: 'text' },
      },
    } as SanitizedCapturedRequest;
    const binary = {
      ...sanitizedRequestWith(),
      id: 'binary',
      request: {
        headers: [],
        body: {
          state: 'binary' as const,
          size: 10,
          capturedSize: 0,
          mimeType: 'image/png',
        },
      },
    } as SanitizedCapturedRequest;

    const har = JSON.parse(toSanitizedHar(sessionWith([withoutMime, binary]))) as {
      log: { entries: { request: { postData?: { mimeType: string } } }[] };
    };

    expect(har.log.entries[0]?.request.postData?.mimeType).toBe('text/plain');
    expect(har.log.entries[1]?.request.postData).toBeUndefined();
  });

  it('clamps negative sizes and unknown timings in the HAR entry', () => {
    const odd = {
      ...sanitizedRequestWith(),
      timing: { totalMs: -5 },
      response: {
        status: 200,
        headers: [],
        body: { state: 'available' as const, size: -1, capturedSize: 0, text: '' },
      },
    } as SanitizedCapturedRequest;

    const har = JSON.parse(toSanitizedHar(sessionWith([odd]))) as {
      log: {
        entries: {
          time: number;
          timings: Record<string, number>;
          response: { content: { size: number } };
        }[];
      };
    };

    expect(har.log.entries[0]?.time).toBe(0);
    expect(har.log.entries[0]?.response.content.size).toBe(0);
    expect(har.log.entries[0]?.timings.blocked).toBe(-1);
  });

  it('records session warning codes in sorted order', () => {
    const har = JSON.parse(
      toSanitizedHar(
        sessionWith([sanitizedRequestWith()], {
          warnings: [
            { code: 'sink-failed', message: 'a' },
            { code: 'invalid-har', message: 'b' },
          ],
        }),
      ),
    ) as { log: { _exhibit: { warningCodes: string[] } } };

    expect(har.log._exhibit.warningCodes).toEqual(['invalid-har', 'sink-failed']);
  });

  it('reports an empty session without inventing sections', () => {
    const report = toQaReport(sessionWith([]));

    expect(report).toContain('# Exhibit QA Report');
    expect(report).toContain('None.');
  });

  it('reports failures, cache hits, and service-worker delivery in the QA report', () => {
    const failed = {
      ...sanitizedRequestWith(),
      id: 'failed',
      response: {
        status: 500,
        headers: [],
        body: { state: 'available' as const, size: 0, capturedSize: 0, text: '' },
      },
    } as SanitizedCapturedRequest;
    const cached = {
      ...sanitizedRequestWith(),
      id: 'cached',
      evidence: { fromCache: true },
    } as SanitizedCapturedRequest;
    const worker = {
      ...sanitizedRequestWith(),
      id: 'worker',
      evidence: { fromServiceWorker: true },
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([failed, cached, worker]));

    expect(report).toContain('HTTP 500');
    expect(report).toContain('## Failures');
  });
});

describe('QA report grouping ties', () => {
  it('orders repeated-call groups deterministically when their times match', () => {
    const make = (id: string, url: string): SanitizedCapturedRequest =>
      ({
        ...sanitizedRequestWith(),
        id,
        url,
        startedAt: 1_000,
      }) as SanitizedCapturedRequest;
    const session = sessionWith([
      make('b1', 'https://app.test/api/beta'),
      make('a1', 'https://app.test/api/alpha'),
      make('b2', 'https://app.test/api/beta'),
      make('a2', 'https://app.test/api/alpha'),
    ]);

    const report = toQaReport(session);
    const repeated = report.slice(report.indexOf('## Repeated calls'));
    const alpha = repeated.indexOf('/api/alpha');
    const beta = repeated.indexOf('/api/beta');

    expect(alpha).toBeGreaterThan(-1);
    expect(beta).toBeGreaterThan(alpha);
  });

  it('lists a single slow call and keeps interactions out of the section when absent', () => {
    const slow = {
      ...sanitizedRequestWith(),
      id: 'slow',
      timing: { totalMs: 4_000 },
    } as SanitizedCapturedRequest;

    const report = toQaReport(sessionWith([slow]));

    expect(report).toContain('## Slow calls');
    expect(report).toContain('4000 ms');
  });

  it('describes requests whose bodies were never captured', () => {
    const unavailable = {
      ...sanitizedRequestWith(),
      id: 'unavailable',
      response: {
        status: 204,
        headers: [],
        body: {
          state: 'unavailable' as const,
          size: 0,
          capturedSize: 0,
          reason: 'content-api-unavailable',
        },
      },
    } as SanitizedCapturedRequest;

    expect(toQaReport(sessionWith([unavailable]))).toContain('HTTP 204');
  });
});

describe('duration reporting resolution', () => {
  it('states a sub-microsecond HAR float at whole-millisecond resolution', () => {
    const request = {
      ...sanitizedRequestWith({
        url: 'https://app.test/api/items',
        responseMime: 'application/json',
        responseText: '{"ok":true}',
      }),
      timing: { totalMs: 123.45600000000002 },
    } as SanitizedCapturedRequest;

    const explanation = explainRequest(request, []);

    expect(explanation.summary).toContain('123 ms');
    expect(explanation.summary).not.toContain('123.456');
    expect(explanation.evidence).toContain('Duration: 123 ms.');
    expect(JSON.stringify(explanation)).not.toContain('00000000');
  });

  it('states a failed request duration at the same resolution', () => {
    const failed = {
      ...sanitizedRequestWith(),
      response: {
        status: 0,
        headers: [],
        body: { state: 'unavailable' as const, size: 0, capturedSize: 0 },
      },
      timing: { totalMs: 40.99999999 },
    } as SanitizedCapturedRequest;

    expect(explainRequest(failed, []).summary).toContain('41 ms');
  });
});
