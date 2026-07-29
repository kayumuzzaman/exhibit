import type { RecordingSession, SessionLimits } from './model';
import { freezeSession } from './ring-buffer';
import type { SanitizedRecordingSession } from './sanitized';

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

/**
 * A restored active phase cannot still own its former panel's capture sources.
 * Close it honestly instead of rendering a recording state that captures
 * nothing after the DevTools panel reloads.
 */
export function closeInterruptedSession(
  session: SanitizedRecordingSession,
  now: number,
): SanitizedRecordingSession {
  if (session.phase === 'stopped') return session;
  return freezeSession({
    ...session,
    phase: 'stopped',
    stoppedAt: now,
  });
}
