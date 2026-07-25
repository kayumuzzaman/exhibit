import type { RecordingSession, SessionLimits } from './model';

export const DEFAULT_LIMITS: SessionLimits = {
  maxRequests: 500,
  maxBytes: 8 * 1024 * 1024,
  maxBodyBytes: 512 * 1024,
};

export function createSession(
  tabId: string,
  origin: string,
  now: number,
): RecordingSession {
  return {
    id: `${tabId}:${now}`,
    tabId,
    origin,
    phase: 'stopped',
    retention: 'ephemeral',
    limits: DEFAULT_LIMITS,
    startedAt: null,
    stoppedAt: null,
    requests: [],
    requestBytes: [],
    byteCount: 0,
    interactions: [],
    evictedCount: 0,
    warnings: [],
  };
}
