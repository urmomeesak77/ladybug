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

// Lets a test hold the register request open to observe the in-flight UI state.
function deferredResult() {
  let resolve!: (result: AuthResult) => void;
  const promise = new Promise<AuthResult>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderRegister(registerResult: AuthResult | Promise<AuthResult>, initialEntry = '/register') {
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
    <MemoryRouter initialEntries={[initialEntry]}>
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
    hash: 'usr0000001',
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

  it('shows a busy spinner and visibly disables the form while the request runs', async () => {
    const pending = deferredResult();
    renderRegister(pending.promise);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    const button = screen.getByRole('button', { name: 'Register' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
    const fieldset = screen.getByLabelText('E-mail').closest('fieldset');
    expect(fieldset?.disabled).toBe(true);

    pending.resolve(okResult);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/verify-email'));
    expect(screen.getByRole('button', { name: 'Register' }).getAttribute('aria-busy')).toBeNull();
  });

  it('links to the login page', () => {
    renderRegister(okResult);

    const link = screen.getByRole('link', { name: 'Already have an account? Login here....' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});

// Feature 017 (US6). Signing up with Google has to be offered where people sign up, and
// a refused round trip returns HERE as well as to /login — so this page gains both the
// door and, for the first time, a form-level alert region to land the refusal in.
describe('RegisterPage — the Google door', () => {
  it('offers the Google option', () => {
    renderRegister(okResult);

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });

  it('separates the two methods with the word "or"', () => {
    renderRegister(okResult);

    // FR-026 is about the WORD: a styled divider alone distinguishes the two methods
    // by appearance only, which a screen-reader user never receives.
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('places the Google option after the form controls', () => {
    renderRegister(okResult);

    const submit = screen.getByRole('button', { name: 'Register' });
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    // Tab order follows DOM order — no tabindex above 0 anywhere (US6 AS2).
    expect(submit.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('raises no alert on an ordinary visit', () => {
    renderRegister(okResult);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['cancelled', 'Google sign-in was cancelled.'],
    ['state', 'That sign-in attempt is no longer valid. Please try again.'],
    [
      'unverified_email',
      'Google did not confirm an e-mail address for that account. Please use e-mail and password instead.',
    ],
    ['already_linked', 'That account is already connected to a different Google account.'],
    ['disabled', 'This account is disabled.'],
    ['rate_limited', 'Too many sign-in attempts. Please wait a moment and try again.'],
    ['provider', 'Google could not be reached. Please try again, or use e-mail and password.'],
  ])('announces the %s refusal in an alert', (code, sentence) => {
    renderRegister(okResult, `/register?error=${code}`);

    // role="alert" so the message is announced, not merely painted (FR-007).
    expect(screen.getByRole('alert').textContent).toBe(sentence);
  });

  it('shows the retryable sentence for a code this build has never heard of', () => {
    renderRegister(okResult, '/register?error=teapot');

    expect(screen.getByRole('alert').textContent)
      .toBe('Google could not be reached. Please try again, or use e-mail and password.');
  });

  it('renders a hand-crafted error parameter as text through the fixed map', () => {
    renderRegister(okResult, '/register?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E');

    // The parameter is a lookup key, never interpolated: nothing of it reaches the DOM,
    // as markup or as text (contracts/ui-surface.md §2).
    const alert = screen.getByRole('alert');
    expect(alert.textContent)
      .toBe('Google could not be reached. Please try again, or use e-mail and password.');
    expect(alert.querySelector('script')).toBeNull();
  });
});
