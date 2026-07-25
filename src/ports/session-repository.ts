import type { RecordingSession } from '../domain/model';

export interface SessionRepository {
  load(sessionId: string): Promise<RecordingSession | null>;
  save(session: RecordingSession): Promise<void>;
  clear(sessionId: string): Promise<void>;
}
