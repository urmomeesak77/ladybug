// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountPasswordForm from '../../src/components/AccountPasswordForm';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';
import { PasswordApi } from '../../src/lib/passwordApi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ada: AuthUser = {
  hash: 'usr0000001',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: null,
  role: 'member',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  hasPassword: true,
  googleLinkedAt: null,
};

function renderForm(hasPassword = true) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const value: AuthContextValue = {
    status: 'authenticated',
    user: { ...ada, hasPassword },
    role: 'member',
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh,
  };
  render(
    <AuthContext.Provider value={value}>
      <AccountPasswordForm hasPassword={hasPassword} />
    </AuthContext.Provider>,
  );
  return { refresh };
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

// Fills whichever of the three fields the current shape renders, with a valid change.
function compose(currentPassword = 'OldPassw0rd'): void {
  const current = screen.queryByLabelText('Current password');
  if (current) {
    fireEvent.change(current, { target: { value: currentPassword } });
  }
  fireEvent.change(field('New password'), { target: { value: 'NewPassw0rd' } });
  fireEvent.change(field('Confirm new password'), { target: { value: 'NewPassw0rd' } });
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
}

describe('AccountPasswordForm — an account with a password', () => {
  it('asks for the current password alongside the new one', () => {
    renderForm();

    expect(field('Current password').type).toBe('password');
    expect(field('New password').type).toBe('password');
    expect(field('Confirm new password').type).toBe('password');
  });

  it('does not offer to save an incomplete change', () => {
    renderForm();

    expect((screen.getByRole('button', { name: 'Save password' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports success in words, clears every field and refreshes the session', async () => {
    const change = vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: true, user: ada });
    const { refresh } = renderForm();

    compose();
    save();

    expect(await screen.findByText('Password updated.')).toBeTruthy();
    expect(change).toHaveBeenCalledWith({
      currentPassword: 'OldPassw0rd',
      password: 'NewPassw0rd',
      passwordConfirmation: 'NewPassw0rd',
    });
    // Nothing typed survives the round trip — a password left in a field is a password
    // left on a shared screen (FR-024's sibling rule for this form).
    expect(field('Current password').value).toBe('');
    expect(field('New password').value).toBe('');
    expect(field('Confirm new password').value).toBe('');
    // The refreshed profile is what flips `hasPassword` and the sign-in method line.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the server refusal and clears all three fields (US3 scenario 3)', async () => {
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({
      ok: false,
      kind: 'validation',
      errors: { current_password: ['The password is incorrect.'] },
    });
    const { refresh } = renderForm();

    compose('GuessedPassw0rd');
    save();

    const error = await screen.findByText('The password is incorrect.');
    // Text tied to the field it is about, never colour alone (Principle IV, contracts §7):
    // the field the server named is the one marked invalid, and the two it did not name
    // are left alone — a wrong current password says nothing about the new one.
    expect(error.getAttribute('role')).toBe('alert');
    expect(field('Current password').getAttribute('aria-invalid')).toBe('true');
    expect(field('Current password').getAttribute('aria-describedby')).toBe(error.getAttribute('id'));
    expect(field('New password').getAttribute('aria-invalid')).toBeNull();
    expect(field('New password').getAttribute('aria-describedby')).toBeNull();
    expect(field('New password').value).toBe('');
    expect(field('Confirm new password').value).toBe('');
    expect(field('Current password').value).toBe('');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('marks the new-password field when the server refuses the password itself', async () => {
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({
      ok: false,
      kind: 'validation',
      errors: { password: ['The password field must be at least 8 characters.'] },
    });
    renderForm();

    compose();
    save();

    const error = await screen.findByText('The password field must be at least 8 characters.');
    expect(field('New password').getAttribute('aria-invalid')).toBe('true');
    expect(field('New password').getAttribute('aria-describedby')).toBe(error.getAttribute('id'));
    expect(field('Current password').getAttribute('aria-invalid')).toBeNull();
  });

  it('marks no field invalid when the refusal is about neither password', async () => {
    // A lapsed session or a spent rate limit says nothing about what was typed, so no
    // input is claimed to be wrong; role="alert" carries the sentence on its own.
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: false, kind: 'rate-limited' });
    renderForm();

    compose();
    save();

    await screen.findByText('Too many attempts. Please try again in a minute.');
    expect(field('Current password').getAttribute('aria-invalid')).toBeNull();
    expect(field('New password').getAttribute('aria-invalid')).toBeNull();
    expect(field('Confirm new password').getAttribute('aria-invalid')).toBeNull();
  });

  it('states a spent rate limit in the shared sentence', async () => {
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: false, kind: 'rate-limited' });
    renderForm();

    compose();
    save();

    expect(await screen.findByText('Too many attempts. Please try again in a minute.')).toBeTruthy();
  });

  it('asks a lapsed session to sign in again', async () => {
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: false, kind: 'auth' });
    renderForm();

    compose();
    save();

    expect(await screen.findByText('Please log in again to change your password.')).toBeTruthy();
  });

  it('disables the whole fieldset while the request runs', async () => {
    let finish!: (result: { ok: true; user: AuthUser }) => void;
    const pending = new Promise<{ ok: true; user: AuthUser }>((resolve) => { finish = resolve; });
    vi.spyOn(PasswordApi, 'changePassword').mockReturnValue(pending);
    renderForm();

    compose();
    save();

    const button = screen.getByRole('button', { name: 'Save password' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect((field('New password').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);

    finish({ ok: true, user: ada });

    expect(await screen.findByText('Password updated.')).toBeTruthy();
  });

  it('clears the previous outcome as soon as a field is edited again', async () => {
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: false, kind: 'network' });
    renderForm();

    compose();
    save();
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();

    fireEvent.change(field('New password'), { target: { value: 'N' } });

    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });
});

// FR-031: the Google-only shape. The current-password field is not merely optional here —
// there is no credential to prove, so the field is gone and the page says why in words.
describe('AccountPasswordForm — a Google-only account', () => {
  it('renders no current-password field at all, not a disabled or hidden one', () => {
    renderForm(false);

    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
  });

  it('states which case the account is in, in text', () => {
    renderForm(false);

    expect(screen.getByText(
      'You sign in with Google. Setting a password adds a second way in — your Google sign-in keeps working.',
    )).toBeTruthy();
  });

  it('sends no current password and reports the first one as set', async () => {
    const change = vi.spyOn(PasswordApi, 'changePassword')
      .mockResolvedValue({ ok: true, user: { ...ada, hasPassword: true } });
    renderForm(false);

    compose();
    save();

    expect(await screen.findByText('Password updated.')).toBeTruthy();
    expect(change).toHaveBeenCalledWith({
      currentPassword: '',
      password: 'NewPassw0rd',
      passwordConfirmation: 'NewPassw0rd',
    });
  });
});
