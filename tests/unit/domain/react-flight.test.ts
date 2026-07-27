import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decodeFlight } from '../../../src/domain/react-flight';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/protocol/${name}`, import.meta.url), 'utf8');

describe('decodeFlight', () => {
  it('decodes only the supported untagged JSON and I/E/T display subset', () => {
    const result = decodeFlight(fixture('supported-flight.txt'), {
      maxBytes: 8_192,
    });

    expect(result).toMatchObject({
      status: 'decoded',
      rawChunks: [],
      warnings: [],
      chunks: [
        {
          id: '0',
          kind: 'json',
          value: { message: 'hello', count: 2 },
        },
        {
          id: '1',
          kind: 'module',
          value: ['app/page.tsx', ['static/chunk.js'], 'default'],
        },
        {
          id: '2',
          kind: 'error',
          value: { digest: 'opaque', message: 'failed' },
        },
        { id: '3', kind: 'text', value: 'plain text' },
      ],
    });
  });

  it('renders references as inert markers without resolving or executing them', () => {
    const result = decodeFlight('1:{"name":"target"}\n2:{"child":"$1"}', {
      maxBytes: 1_024,
    });

    expect(result.status).toBe('decoded');
    expect(result.chunks[1]).toMatchObject({
      id: '2',
      value: {
        child: {
          kind: 'reference',
          raw: '$1',
          targetId: '1',
          resolved: true,
        },
      },
      references: [{ raw: '$1', targetId: '1', resolved: true }],
    });
  });

  it('keeps unresolved references in the raw fallback', () => {
    const line = '2:{"child":"$ff"}';
    const result = decodeFlight(line, { maxBytes: 1_024 });

    expect(result.status).toBe('partial');
    expect(result.rawChunks).toEqual([line]);
    expect(result.warnings).toContain(
      'Chunk 2 contains an unresolved reference to ff.',
    );
    expect(result.chunks[0]).toMatchObject({
      references: [{ raw: '$ff', targetId: 'ff', resolved: false }],
    });
  });

  it('preserves unknown tags, malformed rows, invalid JSON, and malformed text frames', () => {
    const result = decodeFlight(fixture('partial-flight.txt'), {
      maxBytes: 8_192,
    });

    expect(result.status).toBe('partial');
    expect(result.chunks).toEqual([
      {
        id: '3',
        kind: 'text',
        value: 'decoded',
        references: [],
      },
    ]);
    expect(result.rawChunks).toEqual([
      '0:Zopaque',
      'not-a-chunk',
      '1:{"unterminated":',
      '2:Tplain',
    ]);
    expect(result.warnings).toEqual([
      'Unknown Flight tag Z in chunk 0.',
      'Malformed Flight row preserved as raw protocol.',
      'Invalid JSON payload in chunk 1.',
      'Malformed length-framed text chunk 2 was preserved as raw protocol.',
    ]);
  });

  it('decodes exact UTF-8 byte-length text frames containing embedded newlines', () => {
    const result = decodeFlight('0:Tb,hello\nworld1:T5,after\n2:T5,é€', {
      maxBytes: 1_024,
    });

    expect(result).toMatchObject({
      status: 'decoded',
      rawChunks: [],
      warnings: [],
      chunks: [
        { id: '0', kind: 'text', value: 'hello\nworld' },
        { id: '1', kind: 'text', value: 'after' },
        { id: '2', kind: 'text', value: 'é€' },
      ],
    });
  });

  it('preserves truncated, malformed, and mid-code-point text frames as raw', () => {
    const cases = ['0:T6,hello', '0:Tplain', '0:T1,é', '0:T1,hello'];

    for (const raw of cases) {
      const result = decodeFlight(raw, { maxBytes: 1_024 });
      expect(result.status).toBe('unsupported');
      expect(result.chunks).toEqual([]);
      expect(result.rawChunks).toEqual([raw]);
      expect(result.warnings[0]).toMatch(/length-framed text chunk 0.*raw protocol/i);
    }
  });

  it('returns unsupported when no row can be decoded', () => {
    const result = decodeFlight('malformed', { maxBytes: 1_024 });

    expect(result).toEqual({
      status: 'unsupported',
      chunks: [],
      rawChunks: ['malformed'],
      warnings: ['Malformed Flight row preserved as raw protocol.'],
    });
  });

  it('rejects the body before parsing when its UTF-8 bytes exceed the limit', () => {
    const result = decodeFlight('0:T8,🙂🙂', { maxBytes: 8 });

    expect(result).toEqual({
      status: 'unsupported',
      chunks: [],
      rawChunks: [],
      warnings: ['Flight body exceeds the 8-byte inspection limit.'],
    });
  });

  it('counts two-byte and three-byte Unicode sequences without allocating an encoded copy', () => {
    expect(decodeFlight('0:T5,é€', { maxBytes: 10 }).status).toBe('decoded');
    expect(decodeFlight('0:T5,é€', { maxBytes: 9 }).warnings).toEqual([
      'Flight body exceeds the 9-byte inspection limit.',
    ]);
  });

  it('clamps a large finite caller byte limit to the shared 512 KiB body cap', () => {
    const text = `0:T80000,${'x'.repeat(512 * 1_024)}`;
    const result = decodeFlight(text, { maxBytes: 10 * 1_024 * 1_024 });

    expect(result).toEqual({
      status: 'unsupported',
      chunks: [],
      rawChunks: [],
      warnings: ['Flight body exceeds the 524288-byte inspection limit.'],
    });
  });

  it('honors a configured row cap without inspecting later rows', () => {
    const result = decodeFlight('0:T4,zero\n1:T3,one\n2:T3,two', {
      maxBytes: 1_024,
      maxRows: 2,
    });

    expect(result.status).toBe('partial');
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['0', '1']);
    expect(result.warnings).toContain(
      'Flight row limit reached; remaining rows were not inspected.',
    );
  });

  it('enforces the absolute 10,000-row cap even when the caller asks for more', () => {
    const text = Array.from(
      { length: 10_001 },
      (_, index) => `${index.toString(16)}:T3,row`,
    ).join('\n');
    const result = decodeFlight(text, {
      maxBytes: 512 * 1_024,
      maxRows: 20_000,
    });

    expect(result.chunks).toHaveLength(10_000);
    expect(result.status).toBe('partial');
    expect(result.warnings.at(-1)).toBe(
      'Flight row limit reached; remaining rows were not inspected.',
    );
  });

  it('fails closed for a non-finite byte limit and retains hard row and depth caps', () => {
    expect(decodeFlight('0:T5,value', { maxBytes: Number.NaN })).toEqual({
      status: 'unsupported',
      chunks: [],
      rawChunks: [],
      warnings: ['Flight body exceeds the 0-byte inspection limit.'],
    });

    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `${index.toString(16)}:T3,row`,
    ).join('\n');
    expect(
      decodeFlight(rows, {
        maxBytes: 512 * 1_024,
        maxRows: Number.NaN,
      }).chunks,
    ).toHaveLength(10_000);

    const deep = `0:${'['.repeat(33)}0${']'.repeat(33)}`;
    expect(
      decodeFlight(deep, {
        maxBytes: 1_024,
        maxDepth: Number.POSITIVE_INFINITY,
      }).status,
    ).toBe('unsupported');
  });

  it('preserves JSON deeper than 32 levels as raw protocol', () => {
    const line = `0:${'['.repeat(33)}0${']'.repeat(33)}`;
    const result = decodeFlight(line, {
      maxBytes: 1_024,
      maxDepth: 100,
    });

    expect(result.status).toBe('unsupported');
    expect(result.rawChunks).toEqual([line]);
    expect(result.warnings).toEqual([
      'JSON payload in chunk 0 exceeds the 32-level display limit.',
    ]);
  });

  it('accepts JSON at the configured depth boundary', () => {
    const result = decodeFlight('0:[[{"ok":true}]]', {
      maxBytes: 1_024,
      maxDepth: 3,
    });

    expect(result).toMatchObject({
      status: 'decoded',
      chunks: [{ value: [[{ ok: true }]] }],
    });
  });

  it('preserves duplicate chunk identifiers as ambiguous raw protocol', () => {
    const result = decodeFlight('a:T5,first\nA:T6,second', {
      maxBytes: 1_024,
    });

    expect(result.status).toBe('partial');
    expect(result.chunks).toEqual([
      {
        id: 'a',
        kind: 'text',
        value: 'first',
        references: [],
      },
    ]);
    expect(result.rawChunks).toEqual(['A:T6,second']);
    expect(result.warnings).toContain(
      'Duplicate Flight chunk identifier a was preserved as raw protocol.',
    );
  });

  it('accepts CRLF input and ignores empty rows', () => {
    const result = decodeFlight('\r\n0:T5,value\r\n\r\n', {
      maxBytes: 1_024,
    });

    expect(result).toMatchObject({
      status: 'decoded',
      chunks: [{ id: '0', kind: 'text', value: 'value' }],
      rawChunks: [],
    });
  });

  it('returns an immutable empty result for empty input', () => {
    const result = decodeFlight('', { maxBytes: 1_024 });

    expect(result).toEqual({
      status: 'unsupported',
      chunks: [],
      rawChunks: [],
      warnings: ['Flight body is empty.'],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.chunks)).toBe(true);
  });

  it('deep-freezes decoded arrays, objects, and reference markers', () => {
    const result = decodeFlight('0:{"items":[{"ref":"$0"}]}', {
      maxBytes: 1_024,
    });
    const value = result.chunks[0]?.value as {
      readonly items: readonly [{ readonly ref: unknown }];
    };

    expect(
      [
        result,
        result.chunks,
        result.chunks[0],
        value,
        value.items,
        value.items[0],
        value.items[0].ref,
      ].every(Object.isFrozen),
    ).toBe(true);
  });
});

describe('decodeFlight warning bounds', () => {
  it('reports one warning for a chunk that repeats the same unresolved reference', () => {
    const references = Array.from({ length: 5_000 }, () => '"$2"').join(',');
    const result = decodeFlight(`0:[${references}]`, { maxBytes: 512 * 1_024 });

    expect(result.warnings).toEqual(['Chunk 0 contains an unresolved reference to 2.']);
    expect(result.rawChunks).toHaveLength(1);
  });

  it('caps warnings when a body carries more distinct defects than the limit', () => {
    const rows = Array.from({ length: 400 }, (_unused, index) => {
      const id = (index + 1).toString(16);
      return `${id}:["$f${id}"]`;
    }).join('\n');
    const result = decodeFlight(rows, { maxBytes: 512 * 1_024 });

    expect(result.warnings).toHaveLength(101);
    expect(result.warnings.at(-1)).toBe(
      'Decode warnings were capped at 100; further warnings were omitted.',
    );
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
  });

  it('collapses the identical malformed-row warning across many bad rows', () => {
    const rows = Array.from({ length: 50 }, () => 'not-a-chunk').join('\n');
    const result = decodeFlight(rows, { maxBytes: 512 * 1_024 });

    expect(result.warnings).toEqual([
      'Malformed Flight row preserved as raw protocol.',
    ]);
    expect(result.rawChunks).toHaveLength(50);
  });
});
