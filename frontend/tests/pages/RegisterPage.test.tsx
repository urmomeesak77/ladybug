// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import RegisterPage from '../../src/pages/RegisterPage';

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
  };
  render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthContext.Provider value={value}>
        <LocationProbe />
        <RegisterPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return register;
}

function fillForm(confirmation = 'Password1') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmation } });
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

describe('RegisterPage', () => {
  it('validates client-side before calling the API', async () => {
    const register = renderRegister(okResult);

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(screen.getByText('Email is required.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('flags a mismatched password confirmation without calling the API', async () => {
    const register = renderRegister(okResult);

    fillForm('Different1');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('navigates home after a successful registration', async () => {
    const register = renderRegister(okResult);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
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

  it('shows a retryable generic message on a network failure', async () => {
    renderRegister({ ok: false, kind: 'network' });

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
  });
});
