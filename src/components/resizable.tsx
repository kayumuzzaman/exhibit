import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

export function ResizeSeparator({
  label,
  max,
  min,
  onChange,
  value,
}: Readonly<{
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  value: number;
}>) {
  const drag = useRef<Readonly<{ start: number; value: number }> | null>(null);

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      if (drag.current === null) return;
      const next = drag.current.value + event.clientX - drag.current.start;
      onChange(Math.max(min, Math.min(max, next)));
    };
    const onEnd = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    // A pointer released outside the panel never reports `pointerup` here, so
    // cancellation and focus loss end the drag too.
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  }, [max, min, onChange]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 32 : 8;
    const next =
      event.key === 'Home'
        ? min
        : event.key === 'End'
          ? max
          : event.key === 'ArrowLeft'
            ? value - step
            : event.key === 'ArrowRight'
              ? value + step
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(Math.max(min, Math.min(max, next)));
  }

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(value)}
      className="resize-separator"
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        // Capturing keeps every move and the release addressed to this element,
        // so a drag released outside the panel still ends. Capture is optional:
        // failing to acquire it must not prevent the drag from starting, and
        // the default action is preserved so the separator still takes focus.
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // A synthetic or already-released pointer cannot be captured.
        }
        drag.current = { start: event.clientX, value };
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      role="separator"
      tabIndex={0}
    >
      <span aria-hidden="true" />
    </div>
  );
}
