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

function renderMenu(label = 'More actions for Ada') {
  const bag = makeItems();
  render(<ActionMenu items={bag.items} label={label} />);
  return bag;
}

describe('ActionMenu (mouse behaviour)', () => {
  it('renders a single trigger button and no open menu initially', () => {
    renderMenu();

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a role="menu" of role="menuitem" items from the items prop when the trigger is clicked', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('menu')).toBeTruthy();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((node) => node.textContent)).toEqual(['Enable', 'Delete permanently']);
  });

  it('toggles the menu closed on a second trigger click', () => {
    renderMenu();
    const trigger = screen.getByRole('button');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the chosen item onChoose and closes the menu', () => {
    const { remove, enable } = renderMenu();

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete permanently/i }));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders no trigger button for an empty items array (FR-006)', () => {
    const { container } = render(<ActionMenu items={[]} label="More actions" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

describe('ActionMenu accessibility labelling (US3, FR-005)', () => {
  it('exposes aria-haspopup, a text aria-label, and aria-expanded reflecting the open state', () => {
    renderMenu('More actions for Ada');
    const trigger = screen.getByRole('button');

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-label')).toBe('More actions for Ada');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders each item as a role="menuitem" carrying a text label', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button'));

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.textContent?.trim()).not.toBe('');
    }
  });
});

describe('ActionMenu keyboard operation (US3, FR-003)', () => {
  it.each(['Enter', ' ', 'ArrowDown'])('opens onto the first item when the trigger receives %s', (key) => {
    renderMenu();
    const trigger = screen.getByRole('button');

    fireEvent.keyDown(trigger, { key });

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  it('rolls focus down and up across the items, wrapping at both ends', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    const [first, second] = screen.getAllByRole('menuitem');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first); // wraps to the top
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(second); // wraps to the bottom
  });

  it.each(['Enter', ' '])('activates the focused item with %s and closes the menu', (key) => {
    const { enable, remove } = renderMenu();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });

    // Move to the second item (Delete permanently) and activate it.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('ActionMenu dismissal (US3, FR-004)', () => {
  it('closes on Escape and returns focus to the trigger, taking no action', () => {
    const { enable, remove } = renderMenu();
    const trigger = screen.getByRole('button');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(enable).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('closes on a pointer-down outside the menu root', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when focus leaves the menu root (Tab away)', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    const first = screen.getAllByRole('menuitem')[0];

    // Focus moves to an element outside the control.
    fireEvent.blur(first, { relatedTarget: document.body });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open when focus moves between its own items', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    const [first, second] = screen.getAllByRole('menuitem');

    fireEvent.blur(first, { relatedTarget: second });

    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
