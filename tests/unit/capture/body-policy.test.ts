import { describe, expect, it, vi } from 'vitest';
import { applyBodyPolicy } from '../../../src/features/capture/body-policy';

describe('applyBodyPolicy', () => {
  it('keeps an empty captured text body available', () => {
    const body = applyBodyPolicy(
      { text: '', encoding: '', mimeType: 'text/plain' },
      0,
      16,
    );

    expect(body).toEqual({
      state: 'available',
      size: 0,
      capturedSize: 0,
      text: '',
      mimeType: 'text/plain',
    });
  });

  it('reports unavailable content separately from an empty body', () => {
    expect(applyBodyPolicy(undefined, 99, 16)).toEqual({
      state: 'unavailable',
      size: 99,
      capturedSize: 0,
      reason: 'content-not-retrieved',
    });
  });

  it('truncates Unicode text at code-point boundaries using UTF-8 bytes', () => {
    const body = applyBodyPolicy(
      { text: 'a😀b', encoding: '', mimeType: 'text/plain' },
      6,
      5,
    );

    expect(body).toEqual({
      state: 'truncated',
      size: 6,
      capturedSize: 5,
      text: 'a😀',
      mimeType: 'text/plain',
      reason: 'body-limit',
    });
  });

  it('does not decode base64 whose decoded bytes exceed limit', () => {
    const body = applyBodyPolicy(
      { text: 'YWJjZGVm', encoding: 'base64', mimeType: 'application/json' },
      6,
      5,
    );

    expect(body).toEqual({
      state: 'truncated',
      size: 6,
      capturedSize: 0,
      mimeType: 'application/json',
      reason: 'body-limit',
    });
  });

  it('summarizes binary bodies without retaining text', () => {
    const body = applyBodyPolicy(
      { text: 'PNG', encoding: '', mimeType: 'image/png' },
      3,
      16,
    );

    expect(body).toEqual({
      state: 'binary',
      size: 3,
      capturedSize: 0,
      mimeType: 'image/png',
      reason: 'binary-mime-type',
    });
  });

  it('keeps streamed content explicit', () => {
    expect(
      applyBodyPolicy(
        { text: '', encoding: '', mimeType: 'text/event-stream', state: 'streamed' },
        0,
        16,
      ),
    ).toMatchObject({ state: 'streamed', reason: 'streamed-response' });
  });

  it('decodes base64 text only when its decoded bytes fit', () => {
    expect(
      applyBodyPolicy(
        { text: 'aGk=', encoding: 'base64', mimeType: 'application/json' },
        2,
        2,
      ),
    ).toEqual({
      state: 'available',
      size: 2,
      capturedSize: 2,
      text: 'hi',
      mimeType: 'application/json',
    });
  });

  it('marks malformed base64 unavailable without treating it as text', () => {
    expect(
      applyBodyPolicy(
        { text: 'not base64!', encoding: 'base64', mimeType: 'text/plain' },
        4,
        16,
      ),
    ).toEqual({
      state: 'unavailable',
      size: 4,
      capturedSize: 0,
      reason: 'invalid-base64',
    });
  });

  it('uses observed byte length when HAR declares no binary size', () => {
    expect(
      applyBodyPolicy({ text: 'PNG', encoding: '', mimeType: 'image/png' }, 0, 16),
    ).toMatchObject({ state: 'binary', size: 3, capturedSize: 0 });
  });

  it('retains a provider-owned reason for a streamed response', () => {
    expect(
      applyBodyPolicy(
        {
          text: '',
          encoding: '',
          mimeType: 'text/event-stream',
          state: 'streamed',
          unavailableReason: 'capture-stopped',
        },
        0,
        16,
      ),
    ).toMatchObject({ state: 'streamed', reason: 'capture-stopped' });
  });

  it('rejects decoded base64 text whose UTF-8 representation exceeds the cap', () => {
    const body = applyBodyPolicy(
      { text: '//8=', encoding: 'base64', mimeType: 'text/plain' },
      2,
      2,
    );

    expect(body).toEqual({
      state: 'unavailable',
      size: 2,
      capturedSize: 0,
      reason: 'invalid-utf8',
    });
  });

  it('never fully encodes plain text before applying the byte cap', () => {
    const originalEncode = TextEncoder.prototype.encode;
    const encode = vi
      .spyOn(TextEncoder.prototype, 'encode')
      .mockImplementation(function guardedEncode(this: TextEncoder, value = '') {
        if (value.length > 3) throw new Error('full-size UTF-8 allocation');
        return originalEncode.call(this, value);
      });

    try {
      expect(
        applyBodyPolicy(
          { text: 'abcdefghij', encoding: '', mimeType: 'text/plain' },
          0,
          3,
        ),
      ).toEqual({
        state: 'truncated',
        size: 10,
        capturedSize: 3,
        text: 'abc',
        mimeType: 'text/plain',
        reason: 'body-limit',
      });
    } finally {
      encode.mockRestore();
    }
  });

  it('enforces an absolute body ceiling when caller limits are unsafe', () => {
    const hardLimit = 8 * 1024 * 1024;
    const body = applyBodyPolicy(
      {
        text: 'x'.repeat(hardLimit + 1),
        encoding: '',
        mimeType: 'text/plain',
      },
      0,
      Number.MAX_SAFE_INTEGER,
    );

    expect(body.state).toBe('truncated');
    expect(body.size).toBe(hardLimit + 1);
    expect(body.capturedSize).toBe(hardLimit);
    expect(body.text).toHaveLength(hardLimit);
  });

  it('reports decoded binary length without allocating decoded bytes', () => {
    expect(
      applyBodyPolicy(
        { text: 'iVBORw==', encoding: 'base64', mimeType: 'image/png' },
        0,
        16,
      ),
    ).toEqual({
      state: 'binary',
      size: 4,
      capturedSize: 0,
      mimeType: 'image/png',
      reason: 'binary-mime-type',
    });
  });

  it('never reports an available body size below captured bytes', () => {
    expect(
      applyBodyPolicy({ text: 'hello', encoding: '', mimeType: 'text/plain' }, 1, 16),
    ).toMatchObject({ state: 'available', size: 5, capturedSize: 5 });
  });

  it.each([
    undefined,
    'application/problem+json',
    'application/javascript',
    'application/xml',
    'application/soap+xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
  ])('retains supported textual MIME type %s as text', (mimeType) => {
    const body = applyBodyPolicy(
      {
        text: 'x',
        encoding: '',
        ...(mimeType === undefined ? {} : { mimeType }),
      },
      0,
      1,
    );

    expect(body).toMatchObject({ state: 'available', text: 'x', capturedSize: 1 });
  });

  it('normalizes invalid sizes before enforcing the body cap', () => {
    expect(
      applyBodyPolicy({ text: 'x', encoding: '', mimeType: '' }, Number.NaN, -1),
    ).toEqual({
      state: 'truncated',
      size: 1,
      capturedSize: 0,
      text: '',
      reason: 'body-limit',
    });
  });

  it('does not retain later characters when the first code point exceeds the cap', () => {
    expect(
      applyBodyPolicy({ text: '😀a', encoding: '', mimeType: 'text/plain' }, 0, 3),
    ).toEqual({
      state: 'truncated',
      size: 5,
      capturedSize: 0,
      text: '',
      mimeType: 'text/plain',
      reason: 'body-limit',
    });
  });

  it('decodes empty and double-padded base64 bodies', () => {
    expect(
      applyBodyPolicy({ text: '', encoding: 'base64', mimeType: 'text/plain' }, 0, 1),
    ).toMatchObject({ state: 'available', text: '', capturedSize: 0 });
    expect(
      applyBodyPolicy(
        { text: 'YQ==', encoding: 'base64', mimeType: 'text/plain' },
        0,
        1,
      ),
    ).toMatchObject({ state: 'available', text: 'a', size: 1, capturedSize: 1 });
  });
});
