// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useMenuKeyboard } from '../../src/hooks/useMenuKeyboard';

// Minimal synthetic events: the hook only reads `key`/`relatedTarget` and calls preventDefault.
function keyEvent(key: string): KeyboardEvent<HTMLElement> {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
}

function blurEvent(relatedTarget: Node | null): FocusEvent<HTMLDivElement> {
  return { relatedTarget } as unknown as FocusEvent<HTMLDivElement>;
}

function twoItems() {
  const first = vi.fn();
  const second = vi.fn();
  return { items: [{ onChoose: first }, { onChoose: second }], first, second };
}

describe('useMenuKeyboard', () => {
  it('starts closed on the first item', () => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));

    expect(result.current.open).toBe(false);
    expect(result.current.activeIndex).toBe(0);
  });

  it('toggle opens onto the first item and closes again', () => {
    const { result } = renderHook(() => useMenuKeyboard(twoItems().items));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(result.current.activeIndex).toBe(0);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('choose runs the item onChoose and closes', () => {
    const onChoose = vi.fn();
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose }]));
    act(() => result.current.toggle());

    act(() => result.current.choose({ onChoose }));

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
  });

  it.each(['Enter', ' ', 'ArrowDown'])('onTriggerKeyDown opens on %s and prevents default', (key) => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));
    const event = keyEvent(key);

    act(() => result.current.onTriggerKeyDown(event));

    expect(result.current.open).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('onTriggerKeyDown ignores an unrelated key', () => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));
    const event = keyEvent('a');

    act(() => result.current.onTriggerKeyDown(event));

    expect(result.current.open).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('onMenuKeyDown rolls the active index down and up, wrapping at both ends', () => {
    const { result } = renderHook(() => useMenuKeyboard(twoItems().items));
    act(() => result.current.toggle());

    act(() => result.current.onMenuKeyDown(keyEvent('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.onMenuKeyDown(keyEvent('ArrowDown')));
    expect(result.current.activeIndex).toBe(0); // wraps to the top
    act(() => result.current.onMenuKeyDown(keyEvent('ArrowUp')));
    expect(result.current.activeIndex).toBe(1); // wraps to the bottom
  });

  it.each(['Enter', ' '])('onMenuKeyDown activates the focused item with %s and closes', (key) => {
    const { items, first, second } = twoItems();
    const { result } = renderHook(() => useMenuKeyboard(items));
    act(() => result.current.toggle());
    act(() => result.current.onMenuKeyDown(keyEvent('ArrowDown'))); // → second

    act(() => result.current.onMenuKeyDown(keyEvent(key)));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it('onMenuKeyDown closes on Escape', () => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));
    act(() => result.current.toggle());

    act(() => result.current.onMenuKeyDown(keyEvent('Escape')));

    expect(result.current.open).toBe(false);
  });

  it('onMenuKeyDown ignores an unrelated key without preventing default', () => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));
    act(() => result.current.toggle());
    const event = keyEvent('a');

    act(() => result.current.onMenuKeyDown(event));

    expect(result.current.open).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('onRootBlur ignores a null relatedTarget but closes when focus moves outside', () => {
    const { result } = renderHook(() => useMenuKeyboard([{ onChoose: vi.fn() }]));
    act(() => result.current.toggle());

    // Null → focus went nowhere addressable; the pointer-down listener covers outside clicks.
    act(() => result.current.onRootBlur(blurEvent(null)));
    expect(result.current.open).toBe(true);

    // A real node outside the (unattached) root closes the menu.
    act(() => result.current.onRootBlur(blurEvent(document.body)));
    expect(result.current.open).toBe(false);
  });
});
