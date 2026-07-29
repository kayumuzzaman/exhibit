import type { RetrievedContent } from './har-types';

export type ContentUnavailableReason =
  'content-api-unavailable' | 'content-callback-timeout' | 'invalid-content-encoding';

export type ContentResult =
  | Readonly<{ ok: true; content: RetrievedContent }>
  | Readonly<{ ok: false; reason: ContentUnavailableReason }>;

export interface ContentRequestLike {
  getContent(
    callback: (content: string, encoding?: string | undefined) => void,
  ): unknown;
}

export type RuntimeLastErrorLike = Readonly<{
  readonly lastError?: Readonly<{ message?: string | undefined }> | undefined;
}>;

export type GetContentOptions = Readonly<{
  runtime?: RuntimeLastErrorLike;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 5_000;

function timeoutDuration(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_TIMEOUT_MS;
}

export function getRequestContent(
  request: ContentRequestLike,
  options: GetContentOptions = {},
): Promise<ContentResult> {
  return new Promise<ContentResult>((resolve) => {
    let settled = false;
    const settle = (result: ContentResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle({ ok: false, reason: 'content-callback-timeout' });
    }, timeoutDuration(options.timeoutMs));

    try {
      request.getContent((content, encoding) => {
        let hasRuntimeError: boolean;
        try {
          hasRuntimeError = options.runtime?.lastError !== undefined;
        } catch {
          hasRuntimeError = true;
        }
        if (hasRuntimeError || typeof content !== 'string') {
          settle({ ok: false, reason: 'content-api-unavailable' });
          return;
        }
        if (encoding !== undefined && encoding !== '' && encoding !== 'base64') {
          settle({ ok: false, reason: 'invalid-content-encoding' });
          return;
        }
        settle({
          ok: true,
          content: {
            text: content,
            encoding: encoding === 'base64' ? 'base64' : '',
          },
        });
      });
    } catch {
      settle({ ok: false, reason: 'content-api-unavailable' });
    }
  });
}
