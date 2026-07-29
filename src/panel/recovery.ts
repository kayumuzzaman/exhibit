import { freezeSession } from '../domain/ring-buffer';
import type { SanitizedRecordingSession } from '../domain/sanitized';

function isCorruptPlaceholder(session: SanitizedRecordingSession): boolean {
  return (
    session.requests.length === 0 &&
    session.interactions.length === 0 &&
    session.warnings.some(({ code }) => code === 'corrupt-session')
  );
}

/**
 * Corrupt storage keeps its original session id. Rebinding only its empty,
 * sanitized placeholder to the inspected page lets explicit Clear target the
 * retained raw record without trusting any invalid stored origin.
 */
export function recoveryForPage(
  recovered: SanitizedRecordingSession | null,
  tabId: string,
  origin: string,
): SanitizedRecordingSession | null {
  if (recovered === null || recovered.tabId !== tabId) return null;
  if (recovered.origin === origin) return recovered;
  if (!isCorruptPlaceholder(recovered)) return null;
  return freezeSession({ ...recovered, origin });
}
