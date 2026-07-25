import type { BodyContent } from '../../domain/model';
import type { RetrievedContent } from './har-types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function validSize(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
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

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function truncateText(value: string, limit: number): { text: string; bytes: number } {
  let text = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > limit) break;
    text += character;
    bytes += characterBytes;
  }
  return { text, bytes };
}

/** Applies storage limits without allocating from HAR's untrusted size fields. */
export function applyBodyPolicy(
  content: RetrievedContent | undefined,
  declaredSize: number,
  maxBodyBytes: number,
): BodyContent {
  const declared = validSize(declaredSize);
  const limit = validSize(maxBodyBytes);
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

  if (!isTextMimeType(mime)) {
    return {
      state: 'binary',
      size:
        declared ||
        (content.encoding === '' ? encoder.encode(content.text).byteLength : 0),
      capturedSize: 0,
      ...(mime === undefined ? {} : { mimeType: mime }),
      reason: 'binary-mime-type',
    };
  }

  let text = content.text;
  let bytes: number;
  if (content.encoding === 'base64') {
    const decodedLength = base64ByteLength(content.text);
    if (decodedLength === undefined) return unavailable(declared, 'invalid-base64');
    if (decodedLength > limit) {
      return {
        state: 'truncated',
        size: declared || decodedLength,
        capturedSize: 0,
        ...(mime === undefined ? {} : { mimeType: mime }),
        reason: 'body-limit',
      };
    }
    const decoded = decodeBase64(content.text);
    if (decoded === undefined) return unavailable(declared, 'invalid-base64');
    text = decoder.decode(decoded);
    bytes = decoded.byteLength;
  } else {
    bytes = encoder.encode(text).byteLength;
  }

  const size = declared || bytes;
  if (bytes > limit) {
    const truncated = truncateText(text, limit);
    return {
      state: 'truncated',
      size,
      capturedSize: truncated.bytes,
      text: truncated.text,
      ...(mime === undefined ? {} : { mimeType: mime }),
      reason: 'body-limit',
    };
  }

  return {
    state: 'available',
    size,
    capturedSize: bytes,
    text,
    ...(mime === undefined ? {} : { mimeType: mime }),
  };
}
