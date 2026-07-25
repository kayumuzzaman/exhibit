import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRequestContent } from '../../../src/features/capture/get-content';

describe('DevTools request content callback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['', undefined, { ok: true, content: { text: '', encoding: '' } }],
    [
      'eyJvayI6dHJ1ZX0=',
      'base64',
      {
        ok: true,
        content: { text: 'eyJvayI6dHJ1ZX0=', encoding: 'base64' },
      },
    ],
  ] as const)(
    'accepts callback content %j with encoding %j',
    async (text, encoding, expected) => {
      const request = {
        getContent(callback: (value: string, valueEncoding?: string) => void) {
          callback(text, encoding);
          return {
            then() {
              throw new Error('callback return was awaited');
            },
          };
        },
      };

      await expect(getRequestContent(request, { timeoutMs: 25 })).resolves.toEqual(
        expected,
      );
    },
  );

  it('rejects an undocumented encoding with a fixed unavailable reason', async () => {
    const request = {
      getContent(callback: (value: string, encoding?: string) => void) {
        callback('secret body', 'gzip');
      },
    };

    await expect(getRequestContent(request, { timeoutMs: 25 })).resolves.toEqual({
      ok: false,
      reason: 'invalid-content-encoding',
    });
  });

  it('converts synchronous API throws to a fixed unavailable reason', async () => {
    const request = {
      getContent() {
        throw new Error('Bearer thrown-secret');
      },
    };

    await expect(getRequestContent(request, { timeoutMs: 25 })).resolves.toEqual({
      ok: false,
      reason: 'content-api-unavailable',
    });
  });

  it('reads runtime.lastError only inside the callback', async () => {
    let insideCallback = false;
    const runtime = {
      get lastError() {
        if (!insideCallback) {
          throw new Error('lastError read outside callback');
        }
        return { message: 'Bearer runtime-secret' };
      },
    };
    const request = {
      getContent(callback: (value: string) => void) {
        insideCallback = true;
        callback('raw secret');
        insideCallback = false;
      },
    };

    await expect(
      getRequestContent(request, { runtime, timeoutMs: 25 }),
    ).resolves.toEqual({
      ok: false,
      reason: 'content-api-unavailable',
    });
  });

  it('settles once when callback fires twice', async () => {
    const request = {
      getContent(callback: (value: string, encoding?: string) => void) {
        callback('first');
        callback('second', 'base64');
      },
    };

    await expect(getRequestContent(request, { timeoutMs: 25 })).resolves.toEqual({
      ok: true,
      content: { text: 'first', encoding: '' },
    });
  });

  it('times out and ignores a late callback', async () => {
    vi.useFakeTimers();
    let callback: ((value: string, encoding?: string) => void) | undefined;
    const request = {
      getContent(listener: (value: string, encoding?: string) => void) {
        callback = listener;
      },
    };
    const result = getRequestContent(request, { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'content-callback-timeout',
    });
    callback?.('Bearer late-secret');
    await expect(result).resolves.toEqual({
      ok: false,
      reason: 'content-callback-timeout',
    });
  });
});
