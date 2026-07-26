function linearChannel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const normalized = hex.replace('#', '');
  if (!/^[\da-f]{6}$/iu.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }
  return (
    0.2126 * linearChannel(normalized.slice(0, 2)) +
    0.7152 * linearChannel(normalized.slice(2, 4)) +
    0.0722 * linearChannel(normalized.slice(4, 6))
  );
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}
