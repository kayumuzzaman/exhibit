import type {
  BodyContent,
  CapturedRequest,
  Classification,
  Header,
} from '../../src/domain/model';
import { redactRequest, DEFAULT_REDACTION_CONFIG } from '../../src/domain/redaction';
import type { SanitizedCapturedRequest } from '../../src/domain/sanitized';

type RequestOverrides = Readonly<{
  id?: string;
  url?: string;
  method?: string;
  startedAt?: number;
  requestHeaders?: readonly Header[];
  requestBody?: BodyContent;
  responseStatus?: number;
  responseStatusText?: string;
  responseHeaders?: readonly Header[];
  responseBody?: BodyContent;
  responseMime?: string;
  responseText?: string;
  durationMs?: number;
  initiator?: string;
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  redirectUrl?: string;
  classification?: Classification;
}>;

function body(mimeType: string | undefined, text: string | undefined): BodyContent {
  const bodyText = text ?? '';
  return {
    state: 'available',
    size: bodyText.length,
    capturedSize: bodyText.length,
    text: bodyText,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

export function requestWith(overrides: RequestOverrides = {}): CapturedRequest {
  return {
    id: overrides.id ?? 'request-1',
    url: overrides.url ?? 'https://app.test/resource',
    method: overrides.method ?? 'GET',
    startedAt: overrides.startedAt ?? 1_700_000_000_000,
    request: {
      headers: overrides.requestHeaders ?? [],
      ...(overrides.requestBody === undefined ? {} : { body: overrides.requestBody }),
    },
    response: {
      status: overrides.responseStatus ?? 200,
      ...(overrides.responseStatusText === undefined
        ? {}
        : { statusText: overrides.responseStatusText }),
      headers: overrides.responseHeaders ?? [],
      body:
        overrides.responseBody ?? body(overrides.responseMime, overrides.responseText),
    },
    timing: { totalMs: overrides.durationMs ?? 20 },
    evidence: {
      ...(overrides.initiator === undefined ? {} : { initiator: overrides.initiator }),
      ...(overrides.fromCache === undefined ? {} : { fromCache: overrides.fromCache }),
      ...(overrides.fromServiceWorker === undefined
        ? {}
        : { fromServiceWorker: overrides.fromServiceWorker }),
      ...(overrides.redirectUrl === undefined
        ? {}
        : { redirectUrl: overrides.redirectUrl }),
    },
    ...(overrides.classification === undefined
      ? {}
      : { classification: overrides.classification }),
  };
}

export function sanitizedRequestWith(
  overrides: RequestOverrides = {},
): SanitizedCapturedRequest {
  return redactRequest(requestWith(overrides), DEFAULT_REDACTION_CONFIG);
}
