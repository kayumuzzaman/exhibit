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
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
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
        drag.current = { start: event.clientX, value };
      }}
      role="separator"
      tabIndex={0}
    >
      <span aria-hidden="true" />
    </div>
  );
}
