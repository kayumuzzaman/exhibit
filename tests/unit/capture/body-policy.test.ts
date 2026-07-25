import { describe, expect, it } from 'vitest';
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
});
