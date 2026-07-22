// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTabsKeyboard } from '../../src/hooks/useTabsKeyboard';

afterEach(cleanup);

// A minimal tablist wired to the hook: three tabs so Home/End are distinct from Left/Right.
// The selected label is surfaced so a test can read where selection landed after a keystroke.
function Harness() {
  const labels = ['One', 'Two', 'Three'];
  const [selected, setSelected] = useState(0);
  const { tabRefs, onKeyDown, tabIndex } = useTabsKeyboard(labels.length, selected, setSelected);
  return (
    <div role="tablist" onKeyDown={onKeyDown}>
      {labels.map((label, index) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={index === selected}
          tabIndex={tabIndex(index)}
          ref={(node) => { tabRefs.current[index] = node; }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function selectedLabel(): string {
  return screen.getByRole('tab', { selected: true }).textContent ?? '';
}

describe('useTabsKeyboard', () => {
  it('moves selection right and wraps at the end', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(selectedLabel()).toBe('Two');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(selectedLabel()).toBe('One'); // wrapped past the last tab
  });

  it('moves selection left and wraps at the start', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(selectedLabel()).toBe('Three'); // wrapped before the first tab
  });

  it('jumps to the first and last tab with Home and End', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(selectedLabel()).toBe('Three');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(selectedLabel()).toBe('One');
  });

  it('exposes a roving tabindex: 0 on the selected tab, -1 on the rest', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('ignores keys it does not handle', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'a' });

    expect(selectedLabel()).toBe('One');
  });
});
