import { useEffect, useRef, useState } from 'react';

// Open/close state and dismissal wiring for the narrow-viewport nav drawer (the left menu the
// `max-width: 50rem` rules hide). This is the ARIA *disclosure* pattern, not the menu-button
// pattern `useMenuKeyboard` implements: the drawer's entries are ordinary links, so there is no
// roving focus and no menu roles — only open state, Escape, and outside dismissal.
export function useNavDrawer() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Escape closes and hands focus back to the trigger; listener lives only while open.
  useEffect(() => {
    if (!open) { return; }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') { return; }
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  // Close on a pointer-down outside the drawer. The trigger is exempt: otherwise its own press
  // would close here and the click right after would reopen, leaving the toggle stuck open.
  useEffect(() => {
    if (!open) { return; }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) { return; }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  // Opening hands focus to the first entry so a keyboard user lands inside the drawer.
  useEffect(() => {
    if (!open) { return; }
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);
  function close(): void { setOpen(false); }
  function toggle(): void { setOpen((value) => !value); }
  return { open, toggle, close, panelRef, triggerRef };
}
