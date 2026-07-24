// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNavDrawer } from '../../src/hooks/useNavDrawer';

afterEach(cleanup);

// Mirrors how PageLayout + LeftMenu wire the hook up: a trigger button, a <nav> panel that is
// always present (CSS hides it in production), and an unrelated node to click outside on.
function Harness() {
  const { open, toggle, close, panelRef, triggerRef } = useNavDrawer();
  return (
    <div>
      <button type="button" ref={triggerRef} onClick={toggle} aria-expanded={open}>
        Menu
      </button>
      <nav ref={panelRef} data-testid="panel" className={open ? 'left-menu--open' : undefined}>
        <a href="/home" onClick={close}>Home</a>
      </nav>
      <p data-testid="outside">outside</p>
    </div>
  );
}

function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

function isOpen(): boolean {
  return screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded') === 'true';
}

describe('useNavDrawer', () => {
  it('starts closed', () => {
    render(<Harness />);

    expect(isOpen()).toBe(false);
    expect(screen.getByTestId('panel').className).toBe('');
  });

  it('toggle opens the drawer and toggles it shut again', () => {
    render(<Harness />);

    openDrawer();
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('panel').className).toBe('left-menu--open');

    openDrawer();
    expect(isOpen()).toBe(false);
  });

  it('moves focus to the first entry when it opens', () => {
    render(<Harness />);

    openDrawer();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Home' }));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }));
  });

  it('ignores keys other than Escape while open', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.keyDown(document, { key: 'a' });

    expect(isOpen()).toBe(true);
  });

  it('closes on a pointer-down outside the panel and the trigger', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByTestId('outside'));

    expect(isOpen()).toBe(false);
  });

  it('stays open on a pointer-down inside the panel', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByRole('link', { name: 'Home' }));

    expect(isOpen()).toBe(true);
  });

  // Without the trigger exemption the trigger's own pointer-down would close the drawer and the
  // click that follows would immediately reopen it — the toggle would appear stuck open.
  it('stays open on a pointer-down on the trigger itself', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Menu' }));

    expect(isOpen()).toBe(true);
  });

  it('close() shuts the drawer, as a chosen menu entry does', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(isOpen()).toBe(false);
  });

  it('detaches its document listeners once closed', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    render(<Harness />);
    openDrawer();

    openDrawer(); // close again

    const events = remove.mock.calls.map((call) => call[0]);
    expect(events).toContain('keydown');
    expect(events).toContain('pointerdown');

    // A stray event after closing must not throw or reopen anything.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(isOpen()).toBe(false);
    remove.mockRestore();
  });
});
