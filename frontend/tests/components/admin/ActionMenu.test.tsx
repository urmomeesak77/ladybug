// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActionMenu from '../../../src/components/admin/ActionMenu';
import type { ActionMenuItem } from '../../../src/components/admin/ActionMenu';

afterEach(cleanup);

// A pair of ordinary items; the second is destructive. Each carries its own onChoose spy so a
// test can assert exactly which item ran.
function makeItems(): { items: ActionMenuItem[]; enable: () => void; remove: () => void } {
  const enable = vi.fn();
  const remove = vi.fn();
  const items: ActionMenuItem[] = [
    { label: 'Enable', onChoose: enable },
    { label: 'Delete permanently', danger: true, onChoose: remove },
  ];
  return { items, enable, remove };
}

describe('ActionMenu (mouse behaviour)', () => {
  it('renders a single trigger button and no open menu initially', () => {
    const { items } = makeItems();
    render(<ActionMenu items={items} />);

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a role="menu" of role="menuitem" items from the items prop when the trigger is clicked', () => {
    const { items } = makeItems();
    render(<ActionMenu items={items} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('menu')).toBeTruthy();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((node) => node.textContent)).toEqual(['Enable', 'Delete permanently']);
  });

  it('toggles the menu closed on a second trigger click', () => {
    const { items } = makeItems();
    render(<ActionMenu items={items} />);
    const trigger = screen.getByRole('button');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the chosen item onChoose and closes the menu', () => {
    const { items, remove, enable } = makeItems();
    render(<ActionMenu items={items} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete permanently/i }));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders no trigger button for an empty items array (FR-006)', () => {
    const { container } = render(<ActionMenu items={[]} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
