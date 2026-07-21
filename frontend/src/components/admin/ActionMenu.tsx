import type { ReactNode } from 'react';

import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';

// One row action: a text `label` that always carries the meaning, an optional decorative `icon`,
// optional destructive `danger` emphasis, and the effect to run when chosen (FR-002).
export type ActionMenuItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onChoose: () => void;
};

// The shared "more actions" kebab menu both admin consoles render their per-row actions through.
// The WAI-ARIA menu-button pattern: a trigger announcing it opens a menu and its open state
// (FR-005), a role="menu" of role="menuitem" buttons, keyboard operation and four-way dismissal
// (both from useMenuKeyboard — US3). `label` is the trigger's accessible name ("More actions for
// <name>"). An empty item list renders nothing, so a row with no permitted action shows no
// trigger (FR-006).
function ActionMenu({ items, label }: { items: ActionMenuItem[]; label: string }) {
  const {
    open, activeIndex, rootRef, triggerRef, itemRefs, toggle, choose, onTriggerKeyDown, onMenuKeyDown, onRootBlur,
  } = useMenuKeyboard(items);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="action-menu" ref={rootRef} onBlur={onRootBlur}>
      <button
        type="button"
        className="action-menu__trigger"
        ref={triggerRef}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        ⋮
      </button>
      {open ? (
        <div className="action-menu__list" role="menu" onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              ref={(node) => { itemRefs.current[index] = node; }}
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
