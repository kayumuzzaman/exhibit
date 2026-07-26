import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PropsWithChildren,
} from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  children,
  description,
  onClose,
  title,
}: PropsWithChildren<
  Readonly<{
    description?: string;
    onClose(): void;
    title: string;
  }>
>) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('[data-initial-focus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => restoreRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    ];
    if (nodes.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = nodes[0]!;
    const last = nodes.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="dialog-backdrop"
      data-dialog-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog"
        onKeyDown={onKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="dialog__rule" />
        <h2 id={titleId}>{title}</h2>
        {description === undefined ? null : <p id={descriptionId}>{description}</p>}
        {children}
      </div>
    </div>
  );
}
