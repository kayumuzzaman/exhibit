export type ClipboardErrorCode = 'denied' | 'unavailable';

export class ClipboardError extends Error {
  readonly code: ClipboardErrorCode;

  constructor(code: ClipboardErrorCode) {
    super(
      code === 'denied'
        ? 'Clipboard permission was denied.'
        : 'Clipboard API is unavailable.',
    );
    this.name = 'ClipboardError';
    this.code = code;
  }
}

function errorName(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  try {
    const name = (error as { readonly name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

export async function copyText(content: string): Promise<void> {
  let clipboard: Clipboard | undefined;
  let writeText: Clipboard['writeText'] | undefined;
  try {
    clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    writeText = clipboard?.writeText;
  } catch {
    throw new ClipboardError('unavailable');
  }
  if (clipboard === undefined || writeText === undefined) {
    throw new ClipboardError('unavailable');
  }
  try {
    await writeText.call(clipboard, content);
  } catch (error) {
    throw new ClipboardError(
      errorName(error) === 'NotAllowedError' ? 'denied' : 'unavailable',
    );
  }
}
