import { describe, expect, it } from 'vitest';

import type { BodyContent, Header } from '../../../src/domain/model';
import { REDACTED } from '../../../src/domain/redaction';
import type { SanitizedCapturedRequest } from '../../../src/domain/sanitized';
import { compareRequests } from '../../../src/features/session/compare-requests';
import { sanitizedRequestWith } from '../../helpers/request-factory';

function jsonBody(value: unknown): BodyContent {
  const text = JSON.stringify(value);
  return {
    state: 'available',
    size: text.length,
    capturedSize: text.length,
    text,
    mimeType: 'application/json',
  };
}

function safeRequest(
  id: string,
  options: Readonly<{
    requestHeaders?: readonly Header[];
    responseHeaders?: readonly Header[];
    requestBody?: BodyContent;
    responseBody?: BodyContent;
    status?: number;
    durationMs?: number;
  }> = {},
): SanitizedCapturedRequest {
  return {
    ...sanitizedRequestWith({
      ...(options.requestHeaders === undefined
        ? {}
        : { requestHeaders: options.requestHeaders }),
      ...(options.responseHeaders === undefined
        ? {}
        : { responseHeaders: options.responseHeaders }),
      ...(options.requestBody === undefined
        ? {}
        : { requestBody: options.requestBody }),
      ...(options.responseBody === undefined
        ? {}
        : { responseBody: options.responseBody }),
      ...(options.status === undefined ? {} : { responseStatus: options.status }),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    }),
    id,
  };
}

describe('compareRequests', () => {
  it('aligns duplicate headers case-insensitively with deterministic normalized names', () => {
    const diff = compareRequests(
      safeRequest('left', {
        requestHeaders: [
          { name: 'X-Tag', value: 'one' },
          { name: 'x-tag', value: 'two' },
          { name: 'X-Only-Left', value: 'left' },
        ],
      }),
      safeRequest('right', {
        requestHeaders: [
          { name: 'x-TAG', value: 'one' },
          { name: 'X-TAG', value: 'three' },
          { name: 'A-First', value: 'right' },
        ],
      }),
    );

    expect(diff.requestHeaders).toEqual([
      {
        name: 'a-first',
        left: [],
        right: ['right'],
        changed: true,
      },
      {
        name: 'x-only-left',
        left: ['left'],
        right: [],
        changed: true,
      },
      {
        name: 'x-tag',
        left: ['one', 'two'],
        right: ['one', 'three'],
        changed: true,
      },
    ]);
  });

  it('aligns JSON object keys regardless of source order', () => {
    const diff = compareRequests(
      safeRequest('left', {
        requestBody: jsonBody({
          stable: true,
          nested: { z: 1, a: 'before' },
        }),
      }),
      safeRequest('right', {
        requestBody: jsonBody({
          nested: { a: 'after', z: 1 },
          stable: true,
        }),
      }),
    );

    expect(diff.requestBody).toEqual({
      format: 'json',
      leftState: 'available',
      rightState: 'available',
      changes: [
        {
          path: '/nested/a',
          kind: 'changed',
          left: 'before',
          right: 'after',
        },
      ],
    });
  });

  it('preserves array order and reports additions/removals by index', () => {
    const diff = compareRequests(
      safeRequest('left', {
        responseBody: jsonBody([{ id: 1 }, { id: 2 }]),
      }),
      safeRequest('right', {
        responseBody: jsonBody([{ id: 2 }, { id: 3 }, { id: 4 }]),
      }),
    );

    expect(diff.responseBody.changes).toEqual([
      {
        path: '/0/id',
        kind: 'changed',
        left: 1,
        right: 2,
      },
      {
        path: '/1/id',
        kind: 'changed',
        left: 2,
        right: 3,
      },
      {
        path: '/2',
        kind: 'added',
        right: { id: 4 },
      },
    ]);
  });

  it('preserves nested JSON prototype-shaped keys without prototype mutation', () => {
    const hostileText =
      '[{"prototype":"visible","nested":{"__proto__":{"polluted":"nested"}},"constructor":{"prototype":"constructor-value"},"__proto__":{"polluted":"root"}}]';
    const diff = compareRequests(
      safeRequest('left', { responseBody: jsonBody([]) }),
      safeRequest('right', {
        responseBody: {
          state: 'available',
          size: hostileText.length,
          capturedSize: hostileText.length,
          text: hostileText,
          mimeType: 'application/json',
        },
      }),
    );
    const added = diff.responseBody.changes[0]?.right as
      Record<string, unknown> | undefined;
    const nested = added?.nested as Record<string, unknown> | undefined;

    expect(diff.responseBody.changes[0]?.path).toBe('/0');
    expect(Object.getPrototypeOf(added)).toBeNull();
    expect(Object.keys(added ?? {})).toEqual([
      '__proto__',
      'constructor',
      'nested',
      'prototype',
    ]);
    expect(Object.hasOwn(added ?? {}, '__proto__')).toBe(true);
    expect(added?.['__proto__']).toEqual({ polluted: 'root' });
    expect(added?.constructor).toEqual({
      prototype: 'constructor-value',
    });
    expect(added?.prototype).toBe('visible');
    expect(Object.getPrototypeOf(nested)).toBeNull();
    expect(Object.hasOwn(nested ?? {}, '__proto__')).toBe(true);
    expect(nested?.['__proto__']).toEqual({ polluted: 'nested' });
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it('degrades invalid and non-JSON bodies to safe text comparison', () => {
    const malformed: BodyContent = {
      state: 'available',
      size: 8,
      capturedSize: 8,
      text: '{"nope":',
      mimeType: 'application/json',
    };
    const unavailable: BodyContent = {
      state: 'unavailable',
      size: 10,
      capturedSize: 0,
      reason: 'not captured',
    };

    expect(
      compareRequests(
        safeRequest('left', { requestBody: malformed }),
        safeRequest('right', {
          requestBody: {
            state: 'available',
            size: 4,
            capturedSize: 4,
            text: 'text',
            mimeType: 'text/plain',
          },
        }),
      ).requestBody,
    ).toEqual({
      format: 'text',
      leftState: 'available',
      rightState: 'available',
      changes: [
        {
          path: '',
          kind: 'changed',
          left: REDACTED,
          right: 'text',
        },
      ],
    });
    expect(() =>
      compareRequests(
        safeRequest('left', { responseBody: unavailable }),
        safeRequest('right'),
      ),
    ).not.toThrow();
  });

  it('reports scalar status and duration changes for UI summaries', () => {
    const diff = compareRequests(
      safeRequest('left', { status: 200, durationMs: 10 }),
      safeRequest('right', { status: 503, durationMs: 40 }),
    );

    expect(diff.status).toEqual({ left: 200, right: 503, changed: true });
    expect(diff.durationMs).toEqual({ left: 10, right: 40, changed: true });
  });
});
