// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NavMenu from '../../src/components/NavMenu';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(cleanup);

const user: AuthUser = {
  id: 1,
  name: 'Ada',
  email: 'ada@example.com',
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

function renderNav(value: AuthContextValue, initialPath = '/account') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthContext.Provider value={value}>
        <NavMenu />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('NavMenu', () => {
  it('offers Login and Register to anonymous visitors', () => {
    renderNav(authValue({ status: 'anonymous' }));

    expect(screen.getByRole('link', { name: 'Login' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Register' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('treats an unresolved session like anonymous so authed items never flash', () => {
    renderNav(authValue({ status: 'unknown' }));

    expect(screen.getByRole('link', { name: 'Login' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('offers Upload, Account and Log out to authenticated users', () => {
    renderNav(authValue({ status: 'authenticated', user }));

    expect(screen.getByRole('link', { name: 'Upload' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Login' })).toBeNull();
  });

  it('logs out and navigates home', async () => {
    const value = authValue({ status: 'authenticated', user });
    renderNav(value, '/account');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('/')).toBeTruthy();
    expect(value.logout).toHaveBeenCalledTimes(1);
  });
});
