import type { RecordingPhase, RetentionMode, SessionWarning } from '../../domain/model';
import type {
  SanitizedInteractionEvent,
  SanitizedRecordingSession,
} from '../../domain/sanitized';
import { addInteractionBounded, freezeSession } from '../../domain/ring-buffer';

export type SessionAction =
  | Readonly<{
      type: 'phase';
      phase: RecordingPhase;
      at: number;
    }>
  | Readonly<{
      type: 'clear';
      at: number;
    }>
  | Readonly<{
      type: 'interaction';
      interaction: SanitizedInteractionEvent;
    }>
  | Readonly<{
      type: 'retention';
      retention: RetentionMode;
    }>
  | Readonly<{
      type: 'warning';
      warning: SessionWarning;
    }>;

function hasWarning(
  session: SanitizedRecordingSession,
  warning: SessionWarning,
): boolean {
  return session.warnings.some(
    (existing) =>
      existing.code === warning.code && existing.requestId === warning.requestId,
  );
}

export function reduceSession(
  session: SanitizedRecordingSession,
  action: SessionAction,
): SanitizedRecordingSession {
  switch (action.type) {
    case 'phase':
      return freezeSession({
        ...session,
        phase: action.phase,
        ...(action.phase === 'recording'
          ? { startedAt: action.at, stoppedAt: null }
          : {}),
        ...(action.phase === 'stopped' && session.phase !== 'stopped'
          ? { stoppedAt: action.at }
          : {}),
      });
    case 'clear':
      return freezeSession({
        ...session,
        phase: 'stopped',
        stoppedAt: action.at,
        requests: [],
        requestBytes: [],
        byteCount: 0,
        interactions: [],
        evictedCount: 0,
        warnings: [],
      });
    case 'interaction':
      return addInteractionBounded(session, action.interaction);
    case 'retention':
      return freezeSession({ ...session, retention: action.retention });
    case 'warning':
      return hasWarning(session, action.warning)
        ? session
        : freezeSession({
            ...session,
            warnings: [...session.warnings, action.warning],
          });
  }
}
