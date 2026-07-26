import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PropsWithChildren,
} from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalSurface({
  children,
  describedBy,
  dismissOnBackdrop = false,
  label,
  labelledBy,
  onClose,
  panelClassName,
  backdropClassName,
}: PropsWithChildren<
  Readonly<{
    backdropClassName: string;
    describedBy?: string;
    dismissOnBackdrop?: boolean;
    label?: string;
    labelledBy?: string;
    onClose(): void;
    panelClassName: string;
  }>
>) {
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
      className={backdropClassName}
      data-dialog-backdrop=""
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (dismissOnBackdrop) onClose();
      }}
    >
      <div
        aria-describedby={describedBy}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={panelClassName}
        onKeyDown={onKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

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
  return (
    <ModalSurface
      backdropClassName="dialog-backdrop"
      labelledBy={titleId}
      onClose={onClose}
      panelClassName="dialog"
      {...(description === undefined ? {} : { describedBy: descriptionId })}
    >
      <div className="dialog__rule" />
      <h2 id={titleId}>{title}</h2>
      {description === undefined ? null : <p id={descriptionId}>{description}</p>}
      {children}
    </ModalSurface>
  );
}
