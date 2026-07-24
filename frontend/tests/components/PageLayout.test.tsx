// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageLayout from '../../src/components/PageLayout';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';

afterEach(cleanup);

const anonymous: AuthContextValue = {
  status: 'anonymous',
  user: null,
  role: 'guest',
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

function renderLayout() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={anonymous}>
        <PageLayout>
          <p>routed view</p>
        </PageLayout>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('PageLayout', () => {
  it('renders the routed view inside the main landmark', () => {
    renderLayout();

    const main = screen.getByRole('main');
    expect(main.textContent).toContain('routed view');
  });

  it('provides banner and navigation landmarks', () => {
    renderLayout();

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  });

  it('links the logo home with the site name as alt text', () => {
    renderLayout();

    const logo = screen.getByRole('img', { name: /online-trash home/i });
    expect(logo.closest('a')?.getAttribute('href')).toBe('/');
  });

  it('keeps the header to the logo only; primary nav lives in the left menu', () => {
    renderLayout();

    const header = screen.getByRole('banner');
    expect(header.querySelectorAll('a')).toHaveLength(1);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(header.contains(nav)).toBe(false);
    expect(nav.closest('.main-container')).not.toBeNull();
  });
});

describe('PageLayout nav drawer', () => {
  it('puts a named toggle in the header, collapsed to start', () => {
    renderLayout();

    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(screen.getByRole('banner').contains(toggle)).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('points the toggle at the nav it controls', () => {
    renderLayout();

    const toggle = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(toggle.getAttribute('aria-controls')).toBe(nav.getAttribute('id'));
    // Disclosure, not menu-button: the entries stay links.
    expect(toggle.getAttribute('aria-haspopup')).toBeNull();
  });

  it('marks the toggle glyph decorative so the button name stays clean', () => {
    const { container } = renderLayout();

    const glyph = container.querySelector('.nav-toggle svg');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens and closes the drawer from the toggle', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(nav.className).toBe('left-menu--open');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(nav.className).toBe('');
  });

  it('renders the backdrop only while the drawer is open, hidden from assistive tech', () => {
    const { container } = renderLayout();
    expect(container.querySelector('.nav-backdrop')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const backdrop = container.querySelector('.nav-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes the drawer when a menu entry is chosen', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer on Escape', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // The load-bearing assertion for the panelRef handoff: if LeftMenu ever stops forwarding
  // the ref to its <nav>, every pointer-down inside the open drawer counts as outside, so
  // tapping an entry would close the drawer before the click could land.
  it('keeps the drawer open on a pointer-down inside the panel', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.pointerDown(screen.getByRole('link', { name: 'Home' }));

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the drawer on a pointer-down on the backdrop', () => {
    const { container } = renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.pointerDown(container.querySelector('.nav-backdrop')!);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
