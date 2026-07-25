import { describe, expect, it } from 'vitest';

import { decodeTextBody } from '../../../src/domain/content-codecs';

describe('decodeTextBody', () => {
  it('decodes bounded JSON without changing nested arrays', () => {
    expect(
      decodeTextBody({
        text: '{"items":[{"safe":"visible"}]}',
        mimeType: 'application/json; charset=utf-8',
      }),
    ).toMatchObject({
      kind: 'json',
      value: { items: [{ safe: 'visible' }] },
      originalBytes: 30,
      capturedBytes: 30,
      truncated: false,
    });
  });

  it('falls back to bounded text for malformed JSON', () => {
    expect(
      decodeTextBody({
        text: '{"unfinished":"%E0%A4%A"',
        mimeType: 'application/json',
      }),
    ).toMatchObject({
      kind: 'text',
      text: '{"unfinished":"%E0%A4%A"',
      issue: 'malformed',
      truncated: false,
    });
  });

  it('preserves duplicate and malformed form fields without throwing', () => {
    expect(
      decodeTextBody({
        text: 'tag=one&tag=two&bad=%E0%A4%A',
        mimeType: 'application/x-www-form-urlencoded',
      }),
    ).toMatchObject({
      kind: 'form',
      fields: [
        { name: 'tag', value: 'one' },
        { name: 'tag', value: 'two' },
        { name: 'bad', value: '\uFFFD%A' },
      ],
    });
  });

  it('decodes multipart text fields from a quoted boundary', () => {
    const text = [
      '--payload-boundary',
      'Content-Disposition: form-data; name="safe"',
      '',
      'visible',
      '--payload-boundary',
      'Content-Disposition: form-data; name="token"',
      '',
      'secret',
      '--payload-boundary--',
      '',
    ].join('\r\n');

    expect(
      decodeTextBody({
        text,
        mimeType: 'multipart/form-data; boundary="payload-boundary"',
      }),
    ).toMatchObject({
      kind: 'multipart',
      fields: [
        { name: 'safe', value: 'visible' },
        { name: 'token', value: 'secret' },
      ],
    });
  });

  it('truncates only at a UTF-8 boundary and reports original byte size', () => {
    expect(
      decodeTextBody({
        text: 'ab😀secret',
        mimeType: 'text/plain',
        maxBytes: 6,
      }),
    ).toMatchObject({
      kind: 'text',
      text: 'ab😀',
      originalBytes: 12,
      capturedBytes: 6,
      truncated: true,
    });
  });

  it('falls back to text when structured input exceeds maximum depth', () => {
    const text = `${'{"child":'.repeat(4)}"value"${'}'.repeat(4)}`;

    expect(
      decodeTextBody({
        text,
        mimeType: 'application/json',
        maxDepth: 3,
      }),
    ).toMatchObject({
      kind: 'text',
      text,
      issue: 'maximum-depth-exceeded',
      truncated: false,
    });
  });

  it('supports direct text input with default limits', () => {
    expect(decodeTextBody('plain text')).toEqual({
      kind: 'text',
      text: 'plain text',
      originalBytes: 10,
      capturedBytes: 10,
      truncated: false,
    });
  });

  it('counts two-byte and three-byte UTF-8 code points', () => {
    expect(
      decodeTextBody({
        text: 'é€',
        mimeType: 'text/plain',
        maxBytes: 2,
      }),
    ).toMatchObject({
      text: 'é',
      originalBytes: 5,
      capturedBytes: 2,
      truncated: true,
    });
  });

  it('decodes vendor JSON MIME types', () => {
    expect(
      decodeTextBody({
        text: '{"safe":true}',
        mimeType: 'application/problem+json',
      }),
    ).toMatchObject({
      kind: 'json',
      value: { safe: true },
    });
  });

  it('bounds JSON objects with more than 10,000 keys', () => {
    const value = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`key${index}`, index]),
    );
    const text = JSON.stringify(value);

    expect(
      decodeTextBody({
        text,
        mimeType: 'application/json',
        maxBytes: 1024 * 1024,
      }),
    ).toMatchObject({
      kind: 'text',
      issue: 'maximum-keys-exceeded',
      truncated: false,
    });
  });

  it('does not invoke accessors on hostile decode input', () => {
    let getterCalls = 0;
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, 'text', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('getter invoked');
      },
    });

    const result = decodeTextBody(
      input as unknown as Parameters<typeof decodeTextBody>[0],
    );

    expect(getterCalls).toBe(0);
    expect(result).toMatchObject({
      kind: 'text',
      text: '',
      originalBytes: 0,
    });
  });

  it('fails closed when hostile descriptor traps throw', () => {
    const input = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('descriptor trap');
        },
      },
    );

    expect(() =>
      decodeTextBody(input as unknown as Parameters<typeof decodeTextBody>[0]),
    ).not.toThrow();
    expect(
      decodeTextBody(input as unknown as Parameters<typeof decodeTextBody>[0]),
    ).toMatchObject({
      kind: 'text',
      text: '',
    });
  });

  it('rejects multipart content without a valid bounded boundary', () => {
    expect(
      decodeTextBody({
        text: 'not-a-valid-multipart-body',
        mimeType: 'multipart/form-data; charset=utf-8',
      }),
    ).toMatchObject({
      kind: 'text',
      issue: 'malformed',
    });
    expect(
      decodeTextBody({
        text: 'not-a-valid-multipart-body',
        mimeType: `multipart/form-data; boundary=${'x'.repeat(201)}`,
      }),
    ).toMatchObject({
      kind: 'text',
      issue: 'malformed',
    });
  });

  it('decodes LF multipart fields and ignores file parts', () => {
    const text = [
      '--b',
      'Content-Disposition: form-data; name=safe',
      '',
      'visible',
      '--b',
      'Content-Disposition: form-data; name=upload; filename=file.txt',
      '',
      'file-content',
      '--b--',
      '',
    ].join('\n');

    expect(
      decodeTextBody({
        text,
        mimeType: 'multipart/form-data; boundary=b',
      }),
    ).toMatchObject({
      kind: 'multipart',
      fields: [{ name: 'safe', value: 'visible' }],
    });
  });
});
