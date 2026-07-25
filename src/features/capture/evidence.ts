import type { CaptureEvidence } from '../../domain/model';

type DataRecord = Record<string, unknown>;

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Vendor fields are optional evidence, never compatibility requirements. */
export function normalizeEvidence(entry: unknown, response: unknown): CaptureEvidence {
  const evidence: DataRecord = {};
  const cache = ownData(entry, '_fromCache');
  if (cache === 'memory' || cache === 'disk') evidence.fromCache = true;
  if (ownData(response, '_fetchedViaServiceWorker') === true) {
    evidence.fromServiceWorker = true;
  }
  const redirectUrl = ownData(response, 'redirectURL');
  if (typeof redirectUrl === 'string' && redirectUrl.length > 0) {
    evidence.redirectUrl = redirectUrl;
  }
  const initiator = ownData(entry, '_initiator');
  const type = ownData(initiator, 'type');
  if (typeof type === 'string' && type.length > 0) evidence.initiator = type;
  return evidence as CaptureEvidence;
}
