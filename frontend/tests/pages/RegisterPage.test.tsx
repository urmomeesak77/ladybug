// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import RegisterPage from '../../src/pages/RegisterPage';

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

function renderRegister(registerResult: AuthResult) {
  const register = vi.fn().mockResolvedValue(registerResult);
  const value: AuthContextValue = {
    status: 'anonymous',
    user: null,
    register,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <LocationProbe />
          <RegisterPage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return register;
}

function fillForm(confirmation = 'Password1') {
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
  fireEvent.change(screen.getByLabelText('Re-type password'), { target: { value: confirmation } });
}

const okResult: AuthResult = {
  ok: true,
  user: {
    id: 1,
    name: 'Ada',
    email: 'ada@example.com',
    emailVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
};

describe('RegisterPage', () => {
  it('validates client-side on submit before calling the API', async () => {
    const register = renderRegister(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Display name is required.')).toBeTruthy();
    expect(screen.getByText('E-mail is required.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('shows password-policy violations on blur, one per line, and gates submit', async () => {
    renderRegister(okResult);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.blur(screen.getByLabelText('Password'));

    const error = await screen.findByText(/must be at least 8 characters/);
    expect(error.textContent).toContain('must contain at least one number');
    expect(screen.getByRole('button', { name: 'Register' })).toHaveProperty('disabled', true);
  });

  it('flags a mismatched password confirmation without calling the API', async () => {
    const register = renderRegister(okResult);

    fillForm('Different1');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('welcomes the user in a dialog and navigates to the verification notice on success', async () => {
    const register = renderRegister(okResult);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    // FR-007: after registering, the user is told to check their email — the
    // dialog mentions it and the page moves to the /verify-email notice.
    expect(await screen.findByText('Welcome, Ada! Check your inbox to verify your e-mail.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/verify-email'));
    expect(register).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'Password1',
      passwordConfirmation: 'Password1',
    });
  });

  it('merges server 422 field errors into the form (server wins)', async () => {
    renderRegister({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email has already been taken.'] },
    });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('The email has already been taken.')).toBeTruthy();
  });

  it('keeps a server field error when another field is blurred', async () => {
    renderRegister({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email has already been taken.'] },
    });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await screen.findByText('The email has already been taken.');

    fireEvent.blur(screen.getByLabelText('Display name'));

    expect(screen.getByText('The email has already been taken.')).toBeTruthy();
  });

  it("clears a field's server error when its value changes", async () => {
    renderRegister({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email has already been taken.'] },
    });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await screen.findByText('The email has already been taken.');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada2@example.com' } });

    expect(screen.queryByText('The email has already been taken.')).toBeNull();
  });

  it('raises a notice dialog on a network failure', async () => {
    renderRegister({ ok: false, kind: 'network' });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Failed to sign up. Please try again.')).toBeTruthy();
  });

  it('links to the login page', () => {
    renderRegister(okResult);

    const link = screen.getByRole('link', { name: 'Already have an account? Login here....' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});
