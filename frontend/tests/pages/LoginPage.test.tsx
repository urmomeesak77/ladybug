// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import LoginPage from '../../src/pages/LoginPage';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

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
        <NoticeProvider>
          <LocationProbe />
          <LoginPage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return login;
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
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
  it('validates client-side on submit before calling the API', async () => {
    const login = renderLogin(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('E-mail is required.')).toBeTruthy();
    expect(screen.getByText('Password is required.')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('validates a field on blur and gates the submit button on errors', async () => {
    renderLogin(okResult);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-email' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login' })).toHaveProperty('disabled', true);
  });

  it('re-enables submit once a blur-flagged field is corrected', async () => {
    renderLogin(okResult);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'not-an-email' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));
    await screen.findByText('Enter a valid email address.');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada@example.com' } });
    fireEvent.blur(screen.getByLabelText('E-mail'));

    await waitFor(() => expect(screen.queryByText('Enter a valid email address.')).toBeNull());
    expect(screen.getByRole('button', { name: 'Login' })).toHaveProperty('disabled', false);
  });

  it('navigates home after a successful login', async () => {
    const login = renderLogin(okResult);

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'Password1' });
  });

  it('shows one non-disclosing message on an authentication failure', async () => {
    renderLogin({ ok: false, kind: 'auth' });

    fillCredentials('ada@example.com', 'WrongPass1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('merges server 422 field errors into the form', async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Server says no.')).toBeTruthy();
  });

  it('raises a notice dialog on a network failure', async () => {
    renderLogin({ ok: false, kind: 'network' });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Failed to log in. Please try again.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('links to the register page', () => {
    renderLogin(okResult);

    const link = screen.getByRole('link', { name: 'No account? Register here....' });
    expect(link.getAttribute('href')).toBe('/register');
  });
});
