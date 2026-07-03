// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';
import AccountPage from '../../src/pages/AccountPage';

afterEach(cleanup);

const ada: AuthUser = {
  id: 1,
  name: 'Ada',
  email: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Surfaces the current route in the DOM so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAccount(user: AuthUser | null) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const value: AuthContextValue = {
    status: 'authenticated',
    user,
    register: vi.fn(),
    login: vi.fn(),
    logout,
  };
  const { container } = render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <LocationProbe />
        <AccountPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { container, logout };
}

describe('AccountPage', () => {
  it('shows the profile name and email', () => {
    renderAccount(ada);

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
  });

  it('logs out and navigates home', async () => {
    const { logout } = renderAccount(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no user is present (type guard)', () => {
    const { container } = renderAccount(null);

    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.account')).toBeNull();
  });
});
