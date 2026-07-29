// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LeftMenu from '../../src/components/LeftMenu';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';
import type { RoleName } from '../../src/lib/role';

afterEach(cleanup);

// Verified on purpose: the authenticated-menu assertions below include Upload,
// which only verified users get.
const user: AuthUser = {
  hash: 'usr0000001',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    role: 'guest' as RoleName,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    ...overrides,
  };
}

// Surfaces the current route so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderMenu(value: AuthContextValue, initialPath = '/account') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthContext.Provider value={value}>
        <LeftMenu />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

// Renders with the drawer props Task 3's PageLayout supplies.
function renderDrawerMenu(value: AuthContextValue, props: {
  open?: boolean;
  onNavigate?: () => void;
}) {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <LeftMenu open={props.open} onNavigate={props.onNavigate} />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('LeftMenu', () => {
  it('offers a combined Login/register entry plus Home to anonymous visitors', () => {
    renderMenu(authValue({ status: 'anonymous' }));

    const login = screen.getByRole('link', { name: 'Login/register' });
    expect(login.getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('treats an unresolved session like anonymous so authed items never flash', () => {
    renderMenu(authValue({ status: 'unknown' }));

    expect(screen.getByRole('link', { name: 'Login/register' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('offers Home, Upload, Account and Log out to authenticated users', () => {
    renderMenu(authValue({ status: 'authenticated', user }));

    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Login/register' })).toBeNull();
  });

  it('hides the Upload entry for an unverified user', () => {
    const unverified = { ...user, emailVerifiedAt: null };
    renderMenu(authValue({ status: 'authenticated', user: unverified }));

    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
    // The rest of the authenticated menu is untouched.
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  it('shows the Trashposts link to an admin', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'admin' }));

    const link = screen.getByRole('link', { name: 'Trashposts' });
    expect(link.getAttribute('href')).toBe('/admin/trashposts');
  });

  it('shows the Trashposts link to a superuser', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'superuser' }));

    expect(screen.getByRole('link', { name: 'Trashposts' })).toBeTruthy();
  });

  it('hides the Trashposts link from a member', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'member' }));

    expect(screen.queryByRole('link', { name: 'Trashposts' })).toBeNull();
  });

  it('hides the Trashposts link from anonymous visitors', () => {
    renderMenu(authValue({ status: 'anonymous', role: 'guest' }));

    expect(screen.queryByRole('link', { name: 'Trashposts' })).toBeNull();
  });

  it('shows the Users link to an admin', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'admin' }));

    const link = screen.getByRole('link', { name: 'Users' });
    expect(link.getAttribute('href')).toBe('/admin/users');
  });

  it('shows the Users link to a superuser', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'superuser' }));

    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
  });

  it('hides the Users link from a member', () => {
    renderMenu(authValue({ status: 'authenticated', user, role: 'member' }));

    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('hides the Users link from anonymous visitors', () => {
    renderMenu(authValue({ status: 'anonymous', role: 'guest' }));

    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('points the Games entry at the sister site for anonymous visitors', () => {
    renderMenu(authValue({ status: 'anonymous' }));

    const games = screen.getByRole('link', { name: 'Games' });
    expect(games.getAttribute('href')).toBe('https://games.online-trash.com');
  });

  it('points the Games entry at the sister site for authenticated users', () => {
    renderMenu(authValue({ status: 'authenticated', user }));

    const games = screen.getByRole('link', { name: 'Games' });
    expect(games.getAttribute('href')).toBe('https://games.online-trash.com');
  });

  it('reports navigation when Games is chosen, so the drawer can close itself', () => {
    const onNavigate = vi.fn();
    renderDrawerMenu(authValue({ status: 'anonymous' }), { open: true, onNavigate });

    fireEvent.click(screen.getByRole('link', { name: 'Games' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('logs out and navigates home', async () => {
    const value = authValue({ status: 'authenticated', user });
    renderMenu(value, '/account');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('/')).toBeTruthy();
    expect(value.logout).toHaveBeenCalledTimes(1);
  });

  it('marks every icon decorative so link names stay clean', () => {
    const { container } = renderMenu(authValue({ status: 'authenticated', user }));

    const icons = container.querySelectorAll('svg.left-menu-icon');
    expect(icons.length).toBe(5);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('renders without the drawer class by default, so the desktop rail is untouched', () => {
    renderMenu(authValue({ status: 'anonymous' }));

    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toBe('');
  });

  it('carries the open class when the drawer is open', () => {
    renderDrawerMenu(authValue({ status: 'anonymous' }), { open: true });

    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toBe('left-menu--open');
  });

  it('reports navigation when a link is chosen, so the drawer can close itself', () => {
    const onNavigate = vi.fn();
    renderDrawerMenu(authValue({ status: 'anonymous' }), { open: true, onNavigate });

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('reports navigation after logging out', async () => {
    const onNavigate = vi.fn();
    const value = authValue({ status: 'authenticated', user });
    renderDrawerMenu(value, { open: true, onNavigate });

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('/')).toBeTruthy();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
