import type { SanitizedRecordingSession } from '../domain/sanitized';

export interface SessionRepository {
  load(sessionId: string): Promise<SanitizedRecordingSession | null>;
  loadCurrent(tabId: string): Promise<SanitizedRecordingSession | null>;
  save(session: SanitizedRecordingSession): Promise<void>;
  flush(): Promise<void>;
  clear(sessionId: string): Promise<void>;
  /** Clears the current-tab locator and any exact record it still references. */
  clearCurrent?(tabId: string): Promise<void>;
}
