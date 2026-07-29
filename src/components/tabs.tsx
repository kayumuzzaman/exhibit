import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem<Id extends string> = Readonly<{
  id: Id;
  label: string;
  content: ReactNode;
}>;

export function Tabs<Id extends string>({
  activeId,
  defaultActiveId,
  label,
  onChange,
  tabs,
  variant = 'default',
}: Readonly<{
  activeId?: Id;
  defaultActiveId: Id;
  label: string;
  onChange?: (id: Id) => void;
  tabs: readonly TabItem<Id>[];
  variant?: 'default' | 'evidence' | 'segmented';
}>) {
  const instanceId = useId();
  const [internalId, setInternalId] = useState(defaultActiveId);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedId = activeId ?? internalId;
  const selected = tabs.find(({ id }) => id === selectedId) ?? tabs[0];

  function select(id: Id): void {
    if (activeId === undefined) setInternalId(id);
    onChange?.(id);
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab !== undefined) {
      select(tab.id);
      buttons.current[next]?.focus();
    }
  }

  if (selected === undefined) return null;
  const tabId = `${instanceId}-${selected.id}-tab`;
  const panelId = `${instanceId}-${selected.id}-panel`;

  return (
    <div className={`tabs tabs--${variant}`}>
      <div aria-label={label} className="tabs__list" role="tablist">
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected.id;
          return (
            <button
              // Only the selected panel is mounted, so pointing at an id that
              // is not in the document would be a dangling reference.
              {...(isSelected ? { 'aria-controls': panelId } : {})}
              aria-selected={isSelected}
              className="tabs__tab"
              id={`${instanceId}-${tab.id}-tab`}
              key={tab.id}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={tabId}
        className="tabs__panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {selected.content}
      </div>
    </div>
  );
}
