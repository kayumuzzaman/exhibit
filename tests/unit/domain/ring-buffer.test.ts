import { describe, expect, it } from 'vitest';

import type {
  CapturedRequest,
  RecordingSession,
  SessionLimits,
} from '../../../src/domain/model';
import { redactSession, DEFAULT_REDACTION_CONFIG } from '../../../src/domain/redaction';
import type {
  SanitizedCapturedRequest,
  SanitizedRecordingSession,
} from '../../../src/domain/sanitized';
import {
  addBounded,
  calculateRequestBytes,
  freezeSession,
  MAX_SESSION_WARNINGS,
  validateSessionLimits,
} from '../../../src/domain/ring-buffer';
import { createSession } from '../../../src/domain/session';
import { sanitizedRequestWith } from '../../helpers/request-factory';

function sessionWithLimits(limits: Partial<SessionLimits>): SanitizedRecordingSession {
  return freezeSession(
    redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 1_000),
        limits: {
          maxRequests: limits.maxRequests ?? 10,
          maxBytes: limits.maxBytes ?? 10_000,
          maxBodyBytes: limits.maxBodyBytes ?? 1_000,
        },
      },
      DEFAULT_REDACTION_CONFIG,
    ),
  );
}

function sizedRequest(id: string, text: string): SanitizedCapturedRequest {
  return sanitizedRequestWith({ id, responseText: text });
}

describe('bounded recording sessions', () => {
  it('evicts the oldest requests by count and records immutable bookkeeping', () => {
    const initial = sessionWithLimits({ maxRequests: 2 });
    const requests = [
      sizedRequest('a', 'one'),
      sizedRequest('b', 'two'),
      sizedRequest('c', 'three'),
    ];
    const next = requests.reduce(addBounded, initial);

    expect(next.requests.map(({ id }) => id)).toEqual([
      requests[1]!.id,
      requests[2]!.id,
    ]);
    expect(next.requestBytes).toHaveLength(2);
    expect(next.byteCount).toBe(
      next.requestBytes.reduce((total, bytes) => total + bytes, 0),
    );
    expect(next.evictedCount).toBe(1);
    expect(initial.requests).toEqual([]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.requests)).toBe(true);
    expect(Object.isFrozen(next.requests[0]?.response)).toBe(true);
  });

  it('measures exact serialized UTF-8 bytes once and evicts by byte budget', () => {
    const ascii = sizedRequest('ascii', 'a');
    const unicode = sizedRequest('unicode', '🧪');
    const unicodeBytes = new TextEncoder().encode(JSON.stringify(unicode)).byteLength;
    const unicodeOnly = sessionWithLimits({
      maxBytes: unicodeBytes,
      maxBodyBytes: unicodeBytes,
    });

    const first = addBounded(unicodeOnly, unicode);
    expect(calculateRequestBytes(unicode)).toBe(unicodeBytes);
    expect(first.byteCount).toBe(unicodeBytes);

    const second = addBounded(first, ascii);
    expect(second.requests.map(({ id }) => id)).toEqual([ascii.id]);
    expect(second.evictedCount).toBe(1);
  });

  it('never reserializes an existing request while evaluating later eviction', () => {
    const value = sizedRequest('measured-once', 'evidence');
    let serializations = 0;
    const instrumented = {
      ...value,
      toJSON: () => {
        serializations += 1;
        return value;
      },
    } as unknown as SanitizedCapturedRequest;
    const first = addBounded(sessionWithLimits({}), instrumented);

    expect(serializations).toBe(1);
    addBounded(first, sizedRequest('next', 'more'));
    expect(serializations).toBe(1);
  });

  it('rejects an individually oversized record without evicting safe evidence', () => {
    const safe = sizedRequest('safe', '');
    const safeBytes = calculateRequestBytes(safe);
    const initial = addBounded(
      sessionWithLimits({
        maxBytes: safeBytes + 5,
        maxBodyBytes: safeBytes + 5,
      }),
      safe,
    );
    const tooLarge = sizedRequest('too-large', 'x'.repeat(200));
    const next = addBounded(initial, tooLarge);

    expect(next.requests.map(({ id }) => id)).toEqual([safe.id]);
    expect(next.byteCount).toBe(safeBytes);
    expect(next.warnings).toContainEqual(
      expect.objectContaining({
        code: 'request-too-large',
        requestId: tooLarge.id,
      }),
    );
  });

  it('caps repeated oversize warnings so rejected input cannot grow memory forever', () => {
    const safe = sizedRequest('safe', '');
    const safeBytes = calculateRequestBytes(safe);
    const initial = sessionWithLimits({
      maxBytes: safeBytes,
      maxBodyBytes: safeBytes,
    });
    let session = initial;
    let lastOversizeId = '';

    for (let index = 0; index < MAX_SESSION_WARNINGS + 5; index += 1) {
      const request = sizedRequest(`oversize-${index}`, 'x'.repeat(200));
      lastOversizeId = request.id;
      session = addBounded(session, request);
    }

    expect(session.warnings).toHaveLength(MAX_SESSION_WARNINGS);
    expect(session.warnings.at(-1)?.requestId).toBe(lastOversizeId);
  });

  it.each([
    { maxRequests: 0, maxBytes: 10, maxBodyBytes: 1 },
    { maxRequests: 1.5, maxBytes: 10, maxBodyBytes: 1 },
    { maxRequests: 1, maxBytes: Number.NaN, maxBodyBytes: 1 },
    { maxRequests: 1, maxBytes: Number.POSITIVE_INFINITY, maxBodyBytes: 1 },
    { maxRequests: 1, maxBytes: 10, maxBodyBytes: 11 },
    { maxRequests: 1, maxBytes: 10, maxBodyBytes: -1 },
  ])(
    'rejects malformed or unsafe limits: $maxRequests/$maxBytes/$maxBodyBytes',
    (limits) => {
      expect(() => validateSessionLimits(limits)).toThrow(RangeError);
    },
  );

  it('returns deeply frozen snapshots without mutating the caller record', () => {
    const request = sizedRequest('freeze-me', 'body');
    const session = addBounded(sessionWithLimits({}), request);

    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(session.requests[0])).toBe(true);
    expect(() => {
      (session.requests as unknown as CapturedRequest[]).push(request);
    }).toThrow(TypeError);
    expect(() => {
      (session.requests[0]!.response as { status: number }).status = 500;
    }).toThrow(TypeError);
    expect(session.requests[0]!.response.status).toBe(200);
  });

  it('normalizes legacy bookkeeping when freezing a valid direct-requests session', () => {
    const request = sizedRequest('legacy', 'data');
    const legacy = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_000),
        requests: [request],
      },
      DEFAULT_REDACTION_CONFIG,
    );

    const frozen = freezeSession(legacy);

    expect(frozen.requestBytes).toEqual([calculateRequestBytes(request)]);
    expect(frozen.byteCount).toBe(frozen.requestBytes[0]);
  });

  it('recomputes forged caller bookkeeping instead of trusting matching shapes', () => {
    const request = sizedRequest('forged', 'evidence');
    const forged = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_100),
        requests: [request],
        requestBytes: [1],
        byteCount: 1,
      },
      DEFAULT_REDACTION_CONFIG,
    );

    const frozen = freezeSession(forged);

    expect(frozen.requestBytes).toEqual([calculateRequestBytes(request)]);
    expect(frozen.byteCount).toBe(calculateRequestBytes(request));
  });

  it('rejects unsafe integers and sparse untrusted request arrays', () => {
    expect(() =>
      validateSessionLimits({
        maxRequests: Number.MAX_SAFE_INTEGER + 1,
        maxBytes: 100,
        maxBodyBytes: 10,
      }),
    ).toThrow(RangeError);

    const sparse = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_200),
        requests: new Array<CapturedRequest>(1),
        requestBytes: [0],
        byteCount: 0,
      },
      DEFAULT_REDACTION_CONFIG,
    );
    expect(() => freezeSession(sparse)).toThrow(TypeError);
  });

  it('prevents a forged byte count from admitting a request above the cap', () => {
    const request = sizedRequest('hidden-oversize', 'x'.repeat(1_000));
    const forged = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_300),
        limits: { maxRequests: 5, maxBytes: 100, maxBodyBytes: 50 },
        requests: [request],
        requestBytes: [1],
        byteCount: 1,
      },
      DEFAULT_REDACTION_CONFIG,
    );

    expect(() => freezeSession(forged)).toThrow(RangeError);
  });

  it('rejects malformed collection shapes and over-count external sessions', () => {
    const malformed = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_400),
        interactions: {} as RecordingSession['interactions'],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    expect(() => freezeSession(malformed)).toThrow(TypeError);

    const overCount = redactSession(
      {
        ...createSession('tab-5', 'https://app.test', 2_500),
        limits: { maxRequests: 1, maxBytes: 10_000, maxBodyBytes: 1_000 },
        requests: [sizedRequest('one', ''), sizedRequest('two', '')],
      },
      DEFAULT_REDACTION_CONFIG,
    );
    expect(() => freezeSession(overCount)).toThrow(RangeError);
  });

  it('normalizes a raw session on insertion and fails closed for undefined JSON', () => {
    const raw = redactSession(
      createSession('tab-5', 'https://app.test', 2_600),
      DEFAULT_REDACTION_CONFIG,
    );
    const request = sizedRequest('raw-insert', 'body');
    const inserted = addBounded(raw, request);
    expect(inserted.requests[0]?.id).toBe(request.id);

    const unserializable = {
      ...sizedRequest('undefined-json', ''),
      toJSON: () => undefined,
    } as unknown as SanitizedCapturedRequest;
    const rejected = addBounded(inserted, unserializable);
    expect(rejected.warnings).toContainEqual(
      expect.objectContaining({
        code: 'request-too-large',
        requestId: unserializable.id,
      }),
    );
  });
});
