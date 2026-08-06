// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoTapToggle } from '../../src/hooks/useVideoTapToggle';

function Harness() {
  const { tapVisible, toggleTapVisible } = useVideoTapToggle();
  return (
    <button type="button" onClick={toggleTapVisible} data-visible={tapVisible}>
      {tapVisible ? 'visible' : 'hidden'}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useVideoTapToggle', () => {
  it('starts hidden', () => {
    const { getByRole } = render(<Harness />);

    expect(getByRole('button').textContent).toBe('hidden');
  });

  it('shows on the first toggle and hides on the second', () => {
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => button.click());
    expect(button.textContent).toBe('hidden');
  });

  it('auto-hides a few seconds after becoming visible', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(3000));
    expect(button.textContent).toBe('hidden');
  });

  it('does not fire a stale auto-hide after a manual re-toggle', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click()); // visible, timer A scheduled
    act(() => vi.advanceTimersByTime(1000));
    act(() => button.click()); // hidden, timer A cleared
    act(() => button.click()); // visible again, timer B scheduled fresh

    // Only 2000ms since timer B started — timer A (which would have fired at the
    // 3000ms mark from the first click) must not have fired early.
    act(() => vi.advanceTimersByTime(2000));
    expect(button.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(1000));
    expect(button.textContent).toBe('hidden');
  });
});
