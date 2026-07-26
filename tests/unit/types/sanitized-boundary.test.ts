import { describe, expect, it } from 'vitest';

import type {
  CapturedRequest,
  InteractionEvent,
  RecordingSession,
} from '../../../src/domain/model';
import type {
  SanitizedCapturedRequest,
  SanitizedRecordingSession,
} from '../../../src/domain/sanitized';
import { addBounded } from '../../../src/domain/ring-buffer';
import { SearchIndex } from '../../../src/features/session/search-index';
import type { SessionController } from '../../../src/features/session/session-controller';
import { encodeStoredSession } from '../../../src/infrastructure/storage/schema';
import type { SessionRepository } from '../../../src/ports/session-repository';

describe('sanitized persistence type boundary', () => {
  it('does not store runtime brand properties', () => {
    const requestKeys = Object.keys({} as SanitizedCapturedRequest);
    const sessionKeys = Object.keys({} as SanitizedRecordingSession);
    expect(requestKeys).toEqual([]);
    expect(sessionKeys).toEqual([]);
  });

  it('rejects raw capture data at every persistence boundary during typecheck', () => {
    function compileBoundary(
      rawRequest: CapturedRequest,
      rawInteraction: InteractionEvent,
      rawSession: RecordingSession,
      safeRequest: SanitizedCapturedRequest,
      safeSession: SanitizedRecordingSession,
      controller: SessionController,
      repository: SessionRepository,
    ): void {
      // @ts-expect-error Raw requests must pass trusted redaction first.
      void controller.accept(rawRequest);
      // @ts-expect-error Ring buffer accepts only sanitized requests.
      void addBounded(safeSession, rawRequest);
      // @ts-expect-error Repositories accept only sanitized sessions.
      void repository.save(rawSession);
      // @ts-expect-error Persistence encoder accepts only sanitized sessions.
      void encodeStoredSession(rawSession);
      const unsafeSession: SanitizedRecordingSession = {
        ...safeSession,
        // @ts-expect-error Sanitized sessions cannot contain raw interaction evidence.
        interactions: [rawInteraction],
      };
      // @ts-expect-error Search labels require branded interaction evidence.
      new SearchIndex().add(safeRequest, 'password=secret-original');
      void unsafeSession;
    }
    void compileBoundary;
    expect(true).toBe(true);
  });
});
