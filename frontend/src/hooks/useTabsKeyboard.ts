import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

// Pure key routing for the WAI-ARIA tablist, kept out of the hook body (Principle II) and as a
// class per the project's prefer-classes convention — it holds no React state of its own.
class TabKeys {
  // Map a keydown to the tab index it should select, or null when the key is not ours. Left/Right
  // move by one (wrapping), Home/End jump to the ends.
  static route(key: string, selected: number, count: number): number | null {
    if (key === 'ArrowRight') { return (selected + 1) % count; }
    if (key === 'ArrowLeft') { return (selected - 1 + count) % count; }
    if (key === 'Home') { return 0; }
    if (key === 'End') { return count - 1; }
    return null;
  }
}

// Keyboard operation for a tablist with automatic activation (selection follows the arrow keys):
// arrow/Home/End routing plus the roving tabindex (0 on the selected tab, -1 on the rest) so Tab
// enters the tablist once. Selection itself lives in the parent — this only drives it.
export function useTabsKeyboard(count: number, selected: number, onSelect: (index: number) => void) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const next = TabKeys.route(event.key, selected, count);
    if (next === null) { return; }
    // Suppress the browser's own caret/scroll handling for the keys we consume.
    event.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  function tabIndex(index: number): 0 | -1 {
    return index === selected ? 0 : -1;
  }

  return { tabRefs, onKeyDown, tabIndex };
}
