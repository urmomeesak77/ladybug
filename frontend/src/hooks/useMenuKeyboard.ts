import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';

// The minimal item shape this controller needs: it only ever activates an item, never inspects
// what the activation does (research D9) — so it stays decoupled from ActionMenuItem's fields.
type MenuChoosable = { onChoose: () => void };

// The imperative effects a keydown can have while the menu is open: move roving focus by a
// delta, activate the focused item, or dismiss the menu. Supplied per-keystroke by the hook.
type MenuKeyContext = { move: (delta: number) => void; activate: () => void; dismiss: () => void };

// Pure key routing for the WAI-ARIA menu, kept out of the hook body (Principle II) and as a
// class per the project's prefer-classes convention — it holds no React state of its own.
class MenuKeys {
  // Keys on the trigger that open the menu onto its first item.
  static opensMenu(key: string): boolean {
    return key === 'Enter' || key === ' ' || key === 'ArrowDown';
  }

  // Route a keydown fired while the menu is open; returns true when it consumed the key so the
  // caller can preventDefault (roving arrows, Enter/Space activate, Escape dismisses).
  static route(key: string, ctx: MenuKeyContext): boolean {
    if (key === 'ArrowDown') { ctx.move(1); return true; }
    if (key === 'ArrowUp') { ctx.move(-1); return true; }
    if (key === 'Enter' || key === ' ') { ctx.activate(); return true; }
    if (key === 'Escape') { ctx.dismiss(); return true; }
    return false;
  }
}

// Keyboard operation and dismissal for the shared ActionMenu (US3): open state, roving focus,
// focus management (open → first item; Escape → trigger), and the four FR-004 dismissal paths
// (item chosen, Escape, outside pointer-down, focus leaving the root).
export function useMenuKeyboard(items: MenuChoosable[]) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Focus the active item while open (open → first; an arrow key → the newly active one).
  useEffect(() => {
    if (open) { itemRefs.current[activeIndex]?.focus(); }
  }, [open, activeIndex]);
  // Close on a pointer-down outside the root; listener attached only while open.
  useEffect(() => {
    if (!open) { return; }
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  function openToFirst(): void { setActiveIndex(0); setOpen(true); }
  function choose(item: MenuChoosable): void { setOpen(false); item.onChoose(); }
  function toggle(): void { if (open) { setOpen(false); } else { openToFirst(); } }
  // preventDefault suppresses the button's native activation so a keyboard open does not also
  // fire a click that would toggle the menu straight back shut.
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (MenuKeys.opensMenu(event.key)) { event.preventDefault(); openToFirst(); }
  }
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const handled = MenuKeys.route(event.key, {
      move: (delta) => setActiveIndex((index) => (index + delta + items.length) % items.length),
      activate: () => choose(items[activeIndex]),
      dismiss: () => { setOpen(false); triggerRef.current?.focus(); },
    });
    if (handled) { event.preventDefault(); }
  }
  // Close when focus leaves the whole control (Tab away). A null relatedTarget is ignored: focus
  // went nowhere addressable (or a programmatic move under jsdom), and a genuine outside click
  // is already covered by the pointer-down listener.
  function onRootBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) { setOpen(false); }
  }
  return {
    open, activeIndex, rootRef, triggerRef, itemRefs,
    toggle, choose, onTriggerKeyDown, onMenuKeyDown, onRootBlur,
  };
}
