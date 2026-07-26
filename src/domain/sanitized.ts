import type { CapturedRequest, InteractionEvent, RecordingSession } from './model';

declare const sanitizedRequestBrand: unique symbol;
declare const sanitizedInteractionBrand: unique symbol;
declare const sanitizedSessionBrand: unique symbol;

/**
 * Compile-time privacy capability. Brand has no runtime property and can only
 * be issued by trusted redaction functions.
 */
export type SanitizedCapturedRequest = CapturedRequest &
  Readonly<{ [sanitizedRequestBrand]: 'sanitized-request' }>;

/** Interaction metadata whose strings crossed trusted redaction. */
export type SanitizedInteractionEvent = InteractionEvent &
  Readonly<{ [sanitizedInteractionBrand]: 'sanitized-interaction' }>;

/**
 * Session whose request and interaction collections crossed trusted redaction.
 * Brands are phantom: serialized session data never contains them.
 */
export type SanitizedRecordingSession = Omit<
  RecordingSession,
  'requests' | 'interactions'
> &
  Readonly<{
    requests: readonly SanitizedCapturedRequest[];
    interactions: readonly SanitizedInteractionEvent[];
    [sanitizedSessionBrand]: 'sanitized-session';
  }>;
