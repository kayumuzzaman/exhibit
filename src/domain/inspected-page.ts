export const RESTRICTED_PAGE_ORIGIN = 'Restricted browser page';
export const UNKNOWN_PAGE_ORIGIN = 'Inspected page';
export const LOCAL_FILE_ORIGIN = 'Local file';

type InspectedLocation = Readonly<{
  href?: unknown;
  origin?: unknown;
}>;

function locationField(value: unknown, field: keyof InspectedLocation): string {
  if (value === null || typeof value !== 'object') return '';
  const candidate = (value as InspectedLocation)[field];
  return typeof candidate === 'string' ? candidate : '';
}

export function safeInspectedOrigin(value: unknown): string {
  const href = locationField(value, 'href');
  const origin = locationField(value, 'origin');
  if (/^(?:chrome|edge|about):/iu.test(href)) return RESTRICTED_PAGE_ORIGIN;
  if (/^file:/iu.test(href)) return LOCAL_FILE_ORIGIN;
  if (/^https?:/iu.test(origin)) {
    try {
      return new URL(origin).origin;
    } catch {
      return UNKNOWN_PAGE_ORIGIN;
    }
  }
  return UNKNOWN_PAGE_ORIGIN;
}
