// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LeftMenu from '../../src/components/LeftMenu';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(cleanup);

// Verified on purpose: the authenticated-menu assertions below include Upload,
// which only verified users get.
const user: AuthUser = {
  id: 1,
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
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
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
    expect(icons.length).toBe(4);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
