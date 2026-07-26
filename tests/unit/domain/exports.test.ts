import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BodyContent,
  CapturedRequest,
  InteractionEvent,
  RecordingSession,
} from '../../../src/domain/model';
import {
  DEFAULT_REDACTION_CONFIG,
  REDACTED,
  redactRequest,
  redactSession,
} from '../../../src/domain/redaction';
import type {
  SanitizedCapturedRequest,
  SanitizedRecordingSession,
} from '../../../src/domain/sanitized';
import { toSafeCurl } from '../../../src/domain/curl';
import { toSanitizedHar } from '../../../src/domain/har-export';
import { toQaReport } from '../../../src/domain/report-export';
import { ClipboardError, copyText } from '../../../src/infrastructure/clipboard';
import { downloadText } from '../../../src/infrastructure/downloads';
import { requestWith } from '../../helpers/request-factory';

const SHELL_TEXT = "quote' $(touch nope); `whoami` $HOME";

function textBody(
  text: string,
  mimeType = 'application/json',
  state: BodyContent['state'] = 'available',
): BodyContent {
  return {
    state,
    size: state === 'truncated' ? text.length + 100 : text.length,
    capturedSize: text.length,
    text,
    mimeType,
    ...(state === 'truncated' ? { reason: 'size limit' } : {}),
  };
}

function rawRequest(
  id: string,
  overrides: Partial<CapturedRequest> = {},
): CapturedRequest {
  const base = requestWith({
    id,
    url: `https://api.test/items?token=secret-original&id=${id}`,
    method: 'POST',
    startedAt: 1_700_000_000_000,
    requestHeaders: [
      { name: 'Authorization', value: 'Bearer secret-original' },
      { name: 'proxy-authorization', value: 'secret-original' },
      { name: 'Cookie', value: 'session=secret-original' },
      { name: 'X-Api-Key', value: 'secret-original' },
      { name: 'X-Safe', value: SHELL_TEXT },
    ],
    requestBody: textBody(
      JSON.stringify({
        token: 'secret-original',
        note: SHELL_TEXT,
      }),
    ),
    responseHeaders: [
      { name: 'Set-Cookie', value: 'session=secret-original' },
      { name: 'X-Session-Token', value: 'secret-original' },
      { name: 'Content-Type', value: 'application/json' },
    ],
    responseBody: textBody(JSON.stringify({ password: 'secret-original', ok: true })),
    responseStatus: 500,
    durationMs: 1_500,
    classification: {
      kind: 'graphql',
      confidence: 'confirmed',
      evidence: ['token=secret-original', 'safe classification evidence'],
    },
  });
  return {
    ...base,
    explanation: {
      outcome: 'server-error',
      summary: 'token=secret-original',
      guidance: ['credential=secret-original', 'safe guidance'],
      evidence: ['apiKey=secret-original', 'safe explanation evidence'],
    },
    evidence: {
      ...base.evidence,
      initiator: 'token=secret-original',
      redirectUrl: 'https://api.test/login?credential=secret-original&safe=visible',
    },
    ...overrides,
  };
}

function safeRequest(
  id: string,
  overrides: Partial<CapturedRequest> = {},
): SanitizedCapturedRequest {
  return {
    ...redactRequest(rawRequest(id, overrides), DEFAULT_REDACTION_CONFIG),
    id,
  };
}

function rawSession(
  requests: readonly CapturedRequest[],
  interactions: readonly InteractionEvent[] = [],
): RecordingSession {
  return {
    id: 'session-1',
    tabId: 'tab-1',
    origin: 'https://app.test',
    phase: 'stopped',
    retention: 'ephemeral',
    limits: {
      maxRequests: 500,
      maxBytes: 8 * 1024 * 1024,
      maxBodyBytes: 512 * 1024,
    },
    startedAt: 1_700_000_000_000,
    stoppedAt: 1_700_000_010_000,
    requests,
    requestBytes: [],
    byteCount: 0,
    interactions,
    evictedCount: 2,
    warnings: [],
  };
}

function safeSession(
  requests: readonly CapturedRequest[],
  interactions: readonly InteractionEvent[] = [],
): SanitizedRecordingSession {
  return redactSession(rawSession(requests, interactions), DEFAULT_REDACTION_CONFIG);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toSafeCurl', () => {
  it('drops credential headers and POSIX-quotes every injection character', () => {
    const output = toSafeCurl(safeRequest('curl'));

    expect(output).not.toMatch(/secret-original|authorization|cookie|x-api-key/i);
    expect(output).toContain(
      "--header 'X-Safe: quote'\\'' $(touch nope); `whoami` $HOME'",
    );
    expect(output).toContain(
      '--data-raw \'{"token":"[REDACTED]","note":"quote\'\\\'\' $(touch nope); `whoami` $HOME"}\'',
    );
  });

  it('uses only captured textual bodies without inventing binary or unavailable data', () => {
    const binary: BodyContent = {
      state: 'binary',
      size: 100,
      capturedSize: 0,
      reason: 'binary response',
    };
    const unavailable: BodyContent = {
      state: 'unavailable',
      size: 100,
      capturedSize: 0,
      reason: 'secret-original unavailable',
    };
    const truncated = textBody('captured-prefix', 'text/plain', 'truncated');

    expect(
      toSafeCurl(safeRequest('binary', { request: { headers: [], body: binary } })),
    ).not.toContain('--data-raw');
    expect(
      toSafeCurl(
        safeRequest('unavailable', {
          request: { headers: [], body: unavailable },
        }),
      ),
    ).not.toContain('--data-raw');
    const truncatedCurl = toSafeCurl(
      safeRequest('truncated', {
        request: { headers: [], body: truncated },
      }),
    );
    expect(truncatedCurl).toContain("--data-raw 'captured-prefix'");
    expect(truncatedCurl).not.toContain('size limit');
  });

  it('sorts headers deterministically without changing duplicate values', () => {
    const request = safeRequest('headers', {
      request: {
        headers: [
          { name: 'Z-Last', value: 'z' },
          { name: 'a-first', value: 'two' },
          { name: 'A-First', value: 'one' },
        ],
      },
    });

    expect(toSafeCurl(request)).toBe(toSafeCurl(request));
    expect(toSafeCurl(request).match(/--header '[^']+'/gu)).toEqual([
      "--header 'A-First: one'",
      "--header 'a-first: two'",
      "--header 'Z-Last: z'",
    ]);
  });
});

describe('toSanitizedHar', () => {
  it('fails closed for opaque request, redirect, and interaction URL paths', () => {
    const request = rawRequest('opaque-urls', {
      url: 'blob:https://app.test/token=secret-original-request',
      evidence: {
        redirectUrl:
          'filesystem:https://app.test/temporary/password=secret-original-redirect',
      },
    });
    const interaction: InteractionEvent = {
      id: 'opaque-interaction',
      tabId: 'tab-1',
      kind: 'navigation',
      occurredAt: 1_700_000_000_100,
      trust: 'trusted',
      url: 'chrome-extension://abcdefghijklmnop/session=secret-original-interaction',
    };
    const session = safeSession([request], [interaction]);
    const safeRequestValue = session.requests[0]!;

    expect(safeRequestValue.url).toBe(REDACTED);
    expect(safeRequestValue.evidence.redirectUrl).toBe(REDACTED);
    expect(session.interactions[0]?.url).toBe(REDACTED);
    expect(toSafeCurl(safeRequestValue)).not.toContain('secret-original');
    expect(toSanitizedHar(session)).not.toContain('secret-original');
    expect(toQaReport(session)).not.toContain('secret-original');
  });

  it('emits deterministic HAR 1.2 entries with sanitized Payloadra metadata', () => {
    const later = rawRequest('later', {
      startedAt: 1_700_000_002_000,
      response: {
        status: 200,
        headers: [],
        body: {
          state: 'binary',
          size: 200,
          capturedSize: 0,
          mimeType: 'application/octet-stream',
          reason: 'binary',
        },
      },
    });
    const earlier = rawRequest('earlier', {
      startedAt: 1_700_000_001_000,
      response: {
        status: 206,
        headers: [
          { name: 'Set-Cookie', value: 'secret-original' },
          { name: 'Content-Type', value: 'text/plain' },
        ],
        body: textBody('captured response', 'text/plain', 'truncated'),
      },
    });
    const session = safeSession([later, earlier]);

    const first = toSanitizedHar(session);
    const second = toSanitizedHar(session);
    const har = JSON.parse(first) as {
      log: {
        version: string;
        entries: Array<{
          startedDateTime: string;
          request: {
            headers: Array<{ name: string; value: string }>;
            queryString: Array<{ name: string; value: string }>;
          };
          response: {
            headers: Array<{ name: string; value: string }>;
            content: { text?: string; _payloadra: { state: string } };
          };
          _payloadra: { sanitized: boolean };
        }>;
        _payloadra: { sanitized: boolean; evictedCount: number };
      };
    };

    expect(first).toBe(second);
    expect(har.log.version).toBe('1.2');
    expect(har.log._payloadra).toMatchObject({
      sanitized: true,
      evictedCount: 2,
    });
    expect(har.log.entries.map(({ startedDateTime }) => startedDateTime)).toEqual([
      new Date(1_700_000_001_000).toISOString(),
      new Date(1_700_000_002_000).toISOString(),
    ]);
    expect(har.log.entries[0]?.request.queryString).toContainEqual({
      name: 'token',
      value: REDACTED,
    });
    expect(har.log.entries[0]?.request.headers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringMatching(/token|auth|cookie/i) }),
      ]),
    );
    expect(har.log.entries[0]?.response.headers).toEqual([
      { name: 'Content-Type', value: 'text/plain' },
    ]);
    expect(har.log.entries[0]?.response.content).toMatchObject({
      text: 'captured response',
      _payloadra: { state: 'truncated' },
    });
    expect(har.log.entries[1]?.response.content).not.toHaveProperty('text');
    expect(har.log.entries[1]?._payloadra.sanitized).toBe(true);
    expect(first).not.toMatch(/secret-original|authorization/i);
  });

  it('does not fabricate request post data for non-textual states', () => {
    const request = rawRequest('streamed', {
      request: {
        headers: [],
        body: {
          state: 'streamed',
          size: 1_000,
          capturedSize: 0,
          reason: 'streamed',
        },
      },
    });
    const har = JSON.parse(toSanitizedHar(safeSession([request]))) as {
      log: { entries: Array<{ request: { postData?: unknown } }> };
    };

    expect(har.log.entries[0]?.request).not.toHaveProperty('postData');
  });

  it('preserves normalized SSL timing in sanitized HAR evidence', () => {
    const request = rawRequest('ssl-timing', {
      timing: {
        totalMs: 30,
        blockedMs: 1,
        dnsMs: 2,
        connectMs: 8,
        sslMs: 5,
        sendMs: 2,
        waitMs: 12,
        receiveMs: 5,
      },
    });
    const har = JSON.parse(toSanitizedHar(safeSession([request]))) as {
      log: { entries: Array<{ timings: Record<string, number> }> };
    };

    expect(har.log.entries[0]?.timings).toMatchObject({
      connect: 8,
      ssl: 5,
    });
  });
});

describe('toQaReport', () => {
  it('never emits raw interaction evidence from any target or URL field', () => {
    const interaction: InteractionEvent = {
      id: 'password=secret-original-event',
      tabId: 'token=secret-original-tab',
      kind: 'submit',
      occurredAt: 1_700_000_000_900,
      trust: 'trusted',
      target: {
        tag: 'password=secret-original-tag',
        role: 'token=secret-original-role',
        name: 'session=secret-original-name',
        id: 'credential=secret-original-id',
        text: 'Bearer secret-original-text',
      },
      url: 'https://app.test/save#access_token=secret-original-url',
    };
    const session = safeSession([rawRequest('interaction')], [interaction]);

    expect(JSON.stringify(session.interactions)).not.toContain('secret-original');
    expect(toQaReport(session)).not.toContain('secret-original');
    expect(toSanitizedHar(session)).not.toContain('secret-original');
  });

  it('sorts timeline calls and covers failures, slow calls, repeats, evidence, and truncation', () => {
    const first = rawRequest('first', {
      url: 'https://api.test/repeated?b=2&a=1',
      method: 'GET',
      startedAt: 1_700_000_001_000,
      response: {
        status: 200,
        headers: [],
        body: textBody('first', 'text/plain'),
      },
      timing: { totalMs: 20 },
      classification: {
        kind: 'api',
        confidence: 'likely',
        evidence: ['safe\n## takeover|pipe'],
      },
    });
    const second = rawRequest('second', {
      url: 'https://api.test/repeated?a=1&b=2',
      method: 'GET',
      startedAt: 1_700_000_003_000,
      response: {
        status: 500,
        headers: [],
        body: textBody('partial', 'text/plain', 'truncated'),
      },
      timing: { totalMs: 1_200 },
    });
    const middle = rawRequest('middle', {
      url: 'https://api.test/middle',
      startedAt: 1_700_000_002_000,
      response: {
        status: 404,
        headers: [],
        body: textBody('missing', 'text/plain'),
      },
      timing: { totalMs: 10 },
    });
    const interactions: readonly InteractionEvent[] = [
      {
        id: 'late',
        tabId: 'tab-1',
        kind: 'click',
        occurredAt: 1_700_000_002_900,
        trust: 'trusted',
        target: { tag: 'button', name: 'Late\n# injected' },
      },
      {
        id: 'early',
        tabId: 'tab-1',
        kind: 'submit',
        occurredAt: 1_700_000_000_900,
        trust: 'trusted',
        target: { tag: 'form', name: 'Early' },
      },
    ];
    const report = toQaReport(safeSession([second, first, middle], interactions));

    expect(report.indexOf('Early')).toBeLessThan(report.indexOf('Late'));
    expect(report.indexOf('/repeated?b=2&amp;a=1')).toBeLessThan(
      report.indexOf('/middle'),
    );
    expect(report).toContain('## Failures');
    expect(report).toContain('HTTP 404');
    expect(report).toContain('HTTP 500');
    expect(report).toContain('## Slow calls');
    expect(report).toContain('1200 ms');
    expect(report).toContain('## Repeated calls');
    expect(report).toContain('2 calls');
    expect(report).toContain('safe\\n\\#\\# takeover\\|pipe');
    expect(report).toContain('response body truncated');
    expect(report).not.toContain('\n# injected');
    expect(report).not.toMatch(/secret-original|authorization|cookie/i);
    expect(report).toBe(toQaReport(safeSession([second, first, middle], interactions)));
  });
});

describe('export privacy capability', () => {
  it('rejects raw capture data at every export boundary during typecheck', () => {
    function compileBoundary(
      rawRequestValue: CapturedRequest,
      rawSessionValue: RecordingSession,
    ): void {
      // @ts-expect-error cURL export requires trusted redaction first.
      void toSafeCurl(rawRequestValue);
      // @ts-expect-error HAR export requires a sanitized session.
      void toSanitizedHar(rawSessionValue);
      // @ts-expect-error Report export requires a sanitized session.
      void toQaReport(rawSessionValue);
    }
    void compileBoundary;
    expect(true).toBe(true);
  });
});

describe('downloadText', () => {
  it('downloads the exact text and cleans up when clicking fails', async () => {
    const events: string[] = [];
    let artifact: Blob | undefined;
    const anchor = {
      hidden: false,
      href: '',
      download: '',
      click() {
        events.push('click');
        throw new Error('click failed');
      },
      remove() {
        events.push('remove');
      },
    } as unknown as HTMLAnchorElement;
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: {
        append: () => events.push('append'),
      },
    } as unknown as Document);
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        artifact = blob;
        events.push('create');
        return 'blob:payloadra';
      },
      revokeObjectURL: (url: string) => events.push(`revoke:${url}`),
    });

    expect(() => downloadText('report.md', 'text/markdown', 'safe')).toThrow(
      'click failed',
    );
    expect(events).toEqual([
      'create',
      'append',
      'click',
      'remove',
      'revoke:blob:payloadra',
    ]);
    expect(anchor).toMatchObject({
      href: 'blob:payloadra',
      download: 'report.md',
      hidden: true,
    });
    expect(artifact?.type).toBe('text/markdown');
    await expect(artifact?.text()).resolves.toBe('safe');
  });

  it('revokes the object URL when anchor creation fails', () => {
    const revoked: string[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('DOM unavailable');
      },
    } as unknown as Document);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:payloadra',
      revokeObjectURL: (url: string) => revoked.push(url),
    });

    expect(() => downloadText('report.md', 'text/markdown', 'safe')).toThrow(
      'DOM unavailable',
    );
    expect(revoked).toEqual(['blob:payloadra']);
  });
});

describe('copyText', () => {
  it('returns a typed unavailable error when Clipboard API is absent', async () => {
    vi.stubGlobal('navigator', undefined);

    await expect(copyText('never log this')).rejects.toEqual(
      expect.objectContaining<Partial<ClipboardError>>({
        name: 'ClipboardError',
        code: 'unavailable',
      }),
    );
  });

  it('returns typed denied and unavailable errors for adapter failures', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    await expect(copyText('safe')).rejects.toMatchObject({ code: 'denied' });

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('adapter failed');
        },
      },
    });
    await expect(copyText('safe')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('resolves after Clipboard API accepts the text', async () => {
    let copied = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });

    await expect(copyText('safe redacted value')).resolves.toBeUndefined();
    expect(copied).toBe('safe redacted value');
  });
});
