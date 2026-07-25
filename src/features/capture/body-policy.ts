import type { BodyContent } from '../../domain/model';
import type { RetrievedContent } from './har-types';

const decoder = new TextDecoder('utf-8', { fatal: true });
const HARD_MAX_BODY_BYTES = 8 * 1024 * 1024;

function validSize(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function effectiveBodyLimit(maxBodyBytes: number): number {
  return Math.min(validSize(maxBodyBytes), HARD_MAX_BODY_BYTES);
}

function mimeType(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isTextMimeType(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.split(';', 1)[0]!.trim().toLowerCase();
  return (
    normalized.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized.endsWith('+json') ||
    normalized === 'application/javascript' ||
    normalized === 'application/xml' ||
    normalized.endsWith('+xml') ||
    normalized === 'application/x-www-form-urlencoded' ||
    normalized === 'multipart/form-data'
  );
}

function unavailable(size: number, reason: string): BodyContent {
  return { state: 'unavailable', size, capturedSize: 0, reason };
}

function base64ByteLength(value: string): number | undefined {
  if (value.length === 0) return 0;
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    return undefined;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type MeasuredText = Readonly<{
  bytes: number;
  prefixBytes: number;
  prefixEnd: number;
}>;

function measureText(value: string, limit: number): MeasuredText {
  let bytes = 0;
  let prefixBytes = 0;
  let prefixEnd = 0;
  let prefixComplete = false;

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let characterBytes: number;
    let characterEnd = index + 1;
    if (first <= 0x7f) {
      characterBytes = 1;
    } else if (first <= 0x7ff) {
      characterBytes = 2;
    } else if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        characterBytes = 4;
        index += 1;
        characterEnd += 1;
      } else {
        characterBytes = 3;
      }
    } else {
      characterBytes = 3;
    }

    bytes += characterBytes;
    if (!prefixComplete && prefixBytes + characterBytes <= limit) {
      prefixBytes += characterBytes;
      prefixEnd = characterEnd;
    } else {
      prefixComplete = true;
    }
  }

  return { bytes, prefixBytes, prefixEnd };
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Applies storage limits without allocating from HAR's untrusted size fields. */
export function applyBodyPolicy(
  content: RetrievedContent | undefined,
  declaredSize: number,
  maxBodyBytes: number,
): BodyContent {
  const declared = validSize(declaredSize);
  const limit = effectiveBodyLimit(maxBodyBytes);
  if (content === undefined) return unavailable(declared, 'content-not-retrieved');

  const mime = mimeType(content.mimeType);
  if (content.state === 'streamed') {
    return {
      state: 'streamed',
      size: declared,
      capturedSize: 0,
      ...(mime === undefined ? {} : { mimeType: mime }),
      reason: content.unavailableReason ?? 'streamed-response',
    };
  }

  const encodedBytes =
    content.encoding === 'base64' ? base64ByteLength(content.text) : undefined;
  if (content.encoding === 'base64' && encodedBytes === undefined) {
    return unavailable(declared, 'invalid-base64');
  }

  if (!isTextMimeType(mime)) {
    const observedSize = encodedBytes ?? measureText(content.text, 0).bytes;
    return {
      state: 'binary',
      size: Math.max(declared, observedSize),
      capturedSize: 0,
      ...(mime === undefined ? {} : { mimeType: mime }),
      reason: 'binary-mime-type',
    };
  }

  let text = content.text;
  let measured: MeasuredText;
  if (content.encoding === 'base64') {
    const decodedLength = encodedBytes!;
    if (decodedLength > limit) {
      return {
        state: 'truncated',
        size: Math.max(declared, decodedLength),
        capturedSize: 0,
        ...(mime === undefined ? {} : { mimeType: mime }),
        reason: 'body-limit',
      };
    }
    const decoded = decodeBase64(content.text);
    const decodedText = decodeUtf8(decoded);
    if (decodedText === undefined) {
      return unavailable(Math.max(declared, decodedLength), 'invalid-utf8');
    }
    text = decodedText;
    measured = {
      bytes: decodedLength,
      prefixBytes: decodedLength,
      prefixEnd: text.length,
    };
  } else {
    measured = measureText(text, limit);
  }

  const size = Math.max(declared, measured.bytes);
  if (measured.bytes > limit) {
    return {
      state: 'truncated',
      size,
      capturedSize: measured.prefixBytes,
      text: text.slice(0, measured.prefixEnd),
      ...(mime === undefined ? {} : { mimeType: mime }),
      reason: 'body-limit',
    };
  }

  return {
    state: 'available',
    size,
    capturedSize: measured.bytes,
    text,
    ...(mime === undefined ? {} : { mimeType: mime }),
  };
}
