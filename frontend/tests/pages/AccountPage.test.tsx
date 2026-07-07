// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser } from '../../src/lib/authApi';
import AccountPage from '../../src/pages/AccountPage';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ada: AuthUser = {
  id: 1,
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: null,
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
    refresh: vi.fn(),
  };
  const { container } = render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <LocationProbe />
          <AccountPage />
        </NoticeProvider>
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

  it('states an unverified email as text and offers the resend action (FR-008)', async () => {
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: true });
    renderAccount(ada);

    // Status is words in the details list, never color alone (Principle IV).
    expect(screen.getByText('Email verification')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    // Same outcome handling as the notice page (shared AuthModel mapping).
    expect(await screen.findByText('Verification link sent. Check your inbox.')).toBeTruthy();
  });

  it('states a verified email and offers no resend control', () => {
    renderAccount({ ...ada, emailVerifiedAt: '2026-07-07T10:00:00Z' });

    expect(screen.getByText('Email verification')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend verification e-mail' })).toBeNull();
  });
});
