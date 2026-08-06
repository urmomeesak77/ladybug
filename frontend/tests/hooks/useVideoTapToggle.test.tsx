// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoTapToggle } from '../../src/hooks/useVideoTapToggle';

function Harness() {
  const { tapVisible, toggleTapVisible, keepTapVisible } = useVideoTapToggle();
  return (
    <div>
      <button type="button" onClick={toggleTapVisible} data-visible={tapVisible}>
        {tapVisible ? 'visible' : 'hidden'}
      </button>
      <button type="button" onClick={keepTapVisible}>
        keep
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useVideoTapToggle', () => {
  it('starts hidden', () => {
    const { getByRole } = render(<Harness />);

    expect(getByRole('button', { name: /visible|hidden/ }).textContent).toBe('hidden');
  });

  it('shows on the first toggle and hides on the second', () => {
    const { getByRole } = render(<Harness />);
    const button = getByRole('button', { name: /visible|hidden/ });

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => button.click());
    expect(button.textContent).toBe('hidden');
  });

  it('auto-hides a few seconds after becoming visible', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button', { name: /visible|hidden/ });

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(3000));
    expect(button.textContent).toBe('hidden');
  });

  it('does not fire a stale auto-hide after a manual re-toggle', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button', { name: /visible|hidden/ });

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

  it('keepTapVisible resets the auto-hide timer while visible, without changing state', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const toggleButton = getByRole('button', { name: /visible|hidden/ });
    const keepButton = getByRole('button', { name: 'keep' });

    act(() => toggleButton.click()); // visible, timer scheduled for +3000ms
    expect(toggleButton.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(2800));
    act(() => keepButton.click()); // re-armed: fresh +3000ms from here
    expect(toggleButton.textContent).toBe('visible');

    // Only 200ms left on the original timer's schedule — it must not have fired.
    act(() => vi.advanceTimersByTime(200));
    expect(toggleButton.textContent).toBe('visible');

    // The rest of the fresh window elapses — it still eventually auto-hides.
    act(() => vi.advanceTimersByTime(2800));
    expect(toggleButton.textContent).toBe('hidden');
  });

  it('keepTapVisible does nothing while hidden', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const toggleButton = getByRole('button', { name: /visible|hidden/ });
    const keepButton = getByRole('button', { name: 'keep' });

    expect(toggleButton.textContent).toBe('hidden');

    act(() => keepButton.click());
    expect(toggleButton.textContent).toBe('hidden');

    // No timer should have been started by keepTapVisible while hidden.
    act(() => vi.advanceTimersByTime(5000));
    expect(toggleButton.textContent).toBe('hidden');
  });
});
