// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthResult } from '../../src/lib/authApi';
import { GoogleAuth } from '../../src/lib/googleAuth';
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
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

// Lets a test hold the login request open to observe the in-flight UI state.
function deferredResult() {
  let resolve!: (result: AuthResult) => void;
  const promise = new Promise<AuthResult>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderLogin(loginResult: AuthResult | Promise<AuthResult>, initialEntry: unknown = '/login') {
  const login = vi.fn().mockResolvedValue(loginResult);
  const value: AuthContextValue = {
    status: 'anonymous',
    user: null,
    register: vi.fn(),
    login,
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[initialEntry as string]}>
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
    hash: 'usr0000001',
    name: 'Ada',
    email: 'ada@example.com',
    emailVerifiedAt: null,
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
    expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'Password1', remember: false });
  });

  it('renders the "Remember me" checkbox unchecked by default', () => {
    renderLogin(okResult);

    expect(screen.getByLabelText('Remember me')).toHaveProperty('checked', false);
  });

  it('never persists a checked "Remember me" across a remount', () => {
    // Spec Assumption/Edge Case: nothing client-side remembers the choice, so a fresh
    // page load always starts from the unchecked default, whatever an earlier login chose.
    renderLogin(okResult);
    fireEvent.click(screen.getByLabelText('Remember me'));
    expect(screen.getByLabelText('Remember me')).toHaveProperty('checked', true);
    cleanup();

    renderLogin(okResult);

    expect(screen.getByLabelText('Remember me')).toHaveProperty('checked', false);
  });

  it('includes the checked "Remember me" state in the submitted login call', async () => {
    const login = renderLogin(okResult);

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByLabelText('Remember me'));
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Password1',
      remember: true,
    }));
  });

  it('returns to the location the auth guard blocked once login succeeds', async () => {
    // Opening a verification link signed out bounces to /login; after signing in
    // the user must land back on the link so it still verifies (D9, scenario 4).
    renderLogin(okResult, {
      pathname: '/login',
      state: { from: { pathname: '/verify-email/abc123', search: '?expires=1&signature=2', hash: '' } },
    });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent)
      .toBe('/verify-email/abc123?expires=1&signature=2'));
  });

  it('shows one non-disclosing message on an authentication failure', async () => {
    renderLogin({ ok: false, kind: 'auth' });

    fillCredentials('ada@example.com', 'WrongPass1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('shows the distinct disabled message when the account is disabled (FR-013)', async () => {
    renderLogin({ ok: false, kind: 'disabled' });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    // Visibly different from the wrong-credentials message: the owner is told the account
    // is disabled, not that their password is wrong (acceptance scenario 3).
    expect(await screen.findByText('This account is disabled.')).toBeTruthy();
  });

  it('merges server 422 field errors into the form', async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Server says no.')).toBeTruthy();
  });

  it('keeps a server field error when another field is blurred', async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await screen.findByText('Server says no.');

    fireEvent.blur(screen.getByLabelText('Password'));

    expect(screen.getByText('Server says no.')).toBeTruthy();
  });

  it("clears a field's server error when its value changes", async () => {
    renderLogin({ ok: false, kind: 'validation', errors: { email: ['Server says no.'] } });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await screen.findByText('Server says no.');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ada2@example.com' } });

    expect(screen.queryByText('Server says no.')).toBeNull();
  });

  it('raises a notice dialog on a network failure', async () => {
    renderLogin({ ok: false, kind: 'network' });

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Failed to log in. Please try again.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('shows a busy spinner and visibly disables the form while the request runs', async () => {
    const pending = deferredResult();
    renderLogin(pending.promise);

    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    const button = screen.getByRole('button', { name: 'Login' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
    const fieldset = screen.getByLabelText('E-mail').closest('fieldset');
    expect(fieldset?.disabled).toBe(true);

    pending.resolve(okResult);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(screen.getByRole('button', { name: 'Login' }).getAttribute('aria-busy')).toBeNull();
  });

  it('links to the register page', () => {
    renderLogin(okResult);

    const link = screen.getByRole('link', { name: 'No account? Register here....' });
    expect(link.getAttribute('href')).toBe('/register');
  });
});

// Feature 017 (US1). The password form above is untouched; these cases cover the Google
// door added beneath it and, above all, that the intended path survives the round trip.
describe('LoginPage — the Google door', () => {
  function clickGoogle() {
    const start = vi.spyOn(GoogleAuth, 'start').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    return start;
  }

  afterEach(() => vi.restoreAllMocks());

  it('offers the Google option', () => {
    renderLogin(okResult);

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });

  it('separates the two methods with the word "or"', () => {
    renderLogin(okResult);

    // FR-026 is about the WORD, not a rule: a styled divider alone distinguishes the
    // methods by appearance only, which colour-blind and screen-reader users lose.
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('places the Google option after the form controls', () => {
    renderLogin(okResult);

    const submit = screen.getByRole('button', { name: 'Login' });
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    // Tab order follows DOM order, so this is the whole of the ordering guarantee —
    // no tabindex above 0 anywhere (US6 AS2).
    expect(submit.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('carries a blocked destination into the start URL', () => {
    renderLogin(okResult, { pathname: '/login', state: { from: { pathname: '/posts/abc' } } });

    // FR-006: this is the same location.state.from the password path already reads.
    // A full-page navigation to Google destroys router state, so it has to travel as
    // ?redirect= or every Google sign-in silently lands on the feed.
    expect(clickGoogle()).toHaveBeenCalledWith('/posts/abc');
  });

  it('encodes that destination as the redirect parameter', () => {
    renderLogin(okResult, { pathname: '/login', state: { from: { pathname: '/posts/abc' } } });
    clickGoogle();

    expect(GoogleAuth.startUrl('/posts/abc')).toContain('?redirect=%2Fposts%2Fabc');
  });

  it('starts with no destination on a bare visit', () => {
    renderLogin(okResult);

    expect(clickGoogle()).toHaveBeenCalledWith(undefined);
  });
});

// Feature 017 (US6/FR-007). A refused round trip lands back here as a real page with a
// plain-language sentence — never a blank page or a raw error (SC-005).
describe('LoginPage — a refused Google round trip', () => {
  it('raises no alert on an ordinary visit', () => {
    renderLogin(okResult);

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
    renderLogin(okResult, `/login?error=${code}`);

    expect(screen.getByRole('alert').textContent).toBe(sentence);
  });

  it('shows the retryable sentence for a code this build has never heard of', () => {
    renderLogin(okResult, '/login?error=teapot');

    expect(screen.getByRole('alert').textContent)
      .toBe('Google could not be reached. Please try again, or use e-mail and password.');
  });

  it('renders a hand-crafted error parameter as text through the fixed map', () => {
    renderLogin(okResult, '/login?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E');

    const alert = screen.getByRole('alert');
    expect(alert.textContent)
      .toBe('Google could not be reached. Please try again, or use e-mail and password.');
    expect(alert.querySelector('script')).toBeNull();
  });

  it('refuses a disabled account through the Google door in the same words as the password door', async () => {
    // SC-006: the same outcome at both front doors, stated identically. Compared against
    // what the password path actually renders rather than against a repeated literal —
    // a divergence in either sentence has to fail this test.
    renderLogin({ ok: false, kind: 'disabled' });
    fillCredentials('ada@example.com', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    const passwordDoor = (await screen.findByRole('alert')).textContent;

    cleanup();
    renderLogin(okResult, '/login?error=disabled');

    expect(screen.getByRole('alert').textContent).toBe(passwordDoor);
  });

  it('lets a fresh password failure replace the message the round trip arrived with', async () => {
    renderLogin({ ok: false, kind: 'auth' }, '/login?error=cancelled');

    expect(screen.getByRole('alert').textContent).toBe('Google sign-in was cancelled.');

    fillCredentials('ada@example.com', 'WrongPass1');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    // The ?error= code is still in the URL, but it describes an older event than the
    // submit the visitor just watched fail.
    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect.');
  });
});
