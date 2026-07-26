// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClipboardError, copyText } from '../../../src/infrastructure/clipboard';
import { downloadText } from '../../../src/infrastructure/downloads';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('clipboard boundary', () => {
  it('writes through the browser clipboard when it is available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyText('curl https://app.test');

    expect(writeText).toHaveBeenCalledWith('curl https://app.test');
  });

  it('reports an unavailable clipboard instead of throwing a raw error', async () => {
    vi.stubGlobal('navigator', {});

    await expect(copyText('value')).rejects.toMatchObject({
      name: 'ClipboardError',
      code: 'unavailable',
    });
  });

  it('reports an unavailable clipboard when reading navigator throws', async () => {
    vi.stubGlobal('navigator', {
      get clipboard(): never {
        throw new Error('blocked');
      },
    });

    await expect(copyText('value')).rejects.toBeInstanceOf(ClipboardError);
  });

  it('maps a denied permission to the denied code', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw denied;
        }),
      },
    });

    await expect(copyText('value')).rejects.toMatchObject({ code: 'denied' });
  });

  it('maps any other write failure to unavailable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw 'string failure';
        }),
      },
    });

    await expect(copyText('value')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('download boundary', () => {
  it('creates, clicks, and revokes a single object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:payloadra');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(globalThis.URL, {
        createObjectURL,
        revokeObjectURL,
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadText('evidence.har', 'application/json', '{"log":{}}');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:payloadra');
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('does not revoke a URL that was never created', () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(globalThis.URL, {
        createObjectURL: vi.fn(() => {
          throw new Error('blob unavailable');
        }),
        revokeObjectURL,
      }),
    );

    expect(() => downloadText('evidence.har', 'application/json', '{}')).toThrow(
      'blob unavailable',
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});
