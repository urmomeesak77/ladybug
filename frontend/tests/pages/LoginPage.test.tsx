// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import LoginPage from '../../src/pages/LoginPage';

afterEach(cleanup);

// Surfaces the current route in the DOM so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderLogin(loginResult: AuthResult) {
  const login = vi.fn().mockResolvedValue(loginResult);
  const value: AuthContextValue = {
    status: 'anonymous',
    user: null,
    register: vi.fn(),
    login,
    logout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={value}>
        <LocationProbe />
        <LoginPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return login;
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

const okResult: AuthResult = {
  ok: true,
  user: {
    id: 1,
    name: 'Ada',
    email: 'ada@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

describe('LoginPage', () => {
  it('validates client-side before calling the API', async () => {
    const login = renderLogin(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email is required.')).toBeTruthy();
    expect(screen.getByText('Password is required.')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('navigates home after a successful login', async () => {
    const login = renderLogin(okResult);

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'Password1' });
  });

  it('shows one non-disclosing message on an authentication failure', async () => {
    renderLogin({ ok: false, kind: 'auth' });

    fillCredentials('ada@example.com', 'WrongPass1');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('merges server 422 field errors into the form', async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Server says no.')).toBeTruthy();
  });

  it('shows a retryable generic message on a network failure', async () => {
    renderLogin({ ok: false, kind: 'network' });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
  });
});
