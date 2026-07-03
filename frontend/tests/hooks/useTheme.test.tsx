// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTheme } from '../../src/hooks/useTheme';
import { Theme } from '../../src/lib/theme';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.colorScheme = '';
});

describe('useTheme', () => {
  it('applies the OS scheme to the document on mount', () => {
    vi.spyOn(Theme, 'prefersDark').mockReturnValue(true);
    vi.spyOn(Theme, 'watchScheme').mockReturnValue(() => undefined);

    renderHook(() => useTheme());

    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows OS scheme changes at runtime and unsubscribes on unmount', () => {
    vi.spyOn(Theme, 'prefersDark').mockReturnValue(false);
    const unwatch = vi.fn();
    let notify: (isDark: boolean) => void = () => undefined;
    vi.spyOn(Theme, 'watchScheme').mockImplementation((listener) => {
      notify = listener;
      return unwatch;
    });

    const { unmount } = renderHook(() => useTheme());
    expect(document.documentElement.style.colorScheme).toBe('light');

    notify(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    unmount();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });
});
