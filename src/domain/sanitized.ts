import type { CapturedRequest, RecordingSession } from './model';

declare const sanitizedRequestBrand: unique symbol;
declare const sanitizedSessionBrand: unique symbol;

/**
 * Compile-time privacy capability. Brand has no runtime property and can only
 * be issued by trusted redaction functions.
 */
export type SanitizedCapturedRequest = CapturedRequest &
  Readonly<{ [sanitizedRequestBrand]: 'sanitized-request' }>;

/**
 * Session whose request collection crossed trusted redaction. Brand is
 * phantom: serialized session data never contains it.
 */
export type SanitizedRecordingSession = Omit<RecordingSession, 'requests'> &
  Readonly<{
    requests: readonly SanitizedCapturedRequest[];
    [sanitizedSessionBrand]: 'sanitized-session';
  }>;
