import { useState } from 'react';
import type { ReactNode } from 'react';

// One row action: a text `label` that always carries the meaning, an optional decorative `icon`,
// optional destructive `danger` emphasis, and the effect to run when chosen (FR-002).
export type ActionMenuItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onChoose: () => void;
};

// The shared "more actions" kebab menu both admin consoles render their per-row actions through.
// This foundational cut is mouse-only — US1/US2 integrate it now, while keyboard operation,
// dismissal, and ARIA labelling land in US3. The trigger toggles a role="menu" of role="menuitem"
// buttons built from `items`; choosing one runs its onChoose then closes. An empty list renders
// nothing at all, so a row with no permitted action shows no trigger (FR-006).
function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) {
    return null;
  }

  function choose(item: ActionMenuItem): void {
    setOpen(false);
    item.onChoose();
  }

  return (
    <div className="action-menu">
      <button type="button" className="action-menu__trigger" onClick={() => setOpen((prev) => !prev)}>
        ⋮
      </button>
      {open ? (
        <div className="action-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'action-menu__item action-menu__item--danger' : 'action-menu__item'}
              onClick={() => choose(item)}
            >
              {item.icon}
              <span className="action-menu__label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ActionMenu;
