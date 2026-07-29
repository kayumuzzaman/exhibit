import type { CaptureOptions } from '../ports/capture-source';

/**
 * Capture the browser-visible ledger once. API-only is then a reversible view
 * filter instead of a destructive capture decision.
 */
export const PRODUCTION_CAPTURE_OPTIONS: CaptureOptions = Object.freeze({
  includeStatic: true,
});
