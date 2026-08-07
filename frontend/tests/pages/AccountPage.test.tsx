// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser } from '../../src/lib/authApi';
import { PasswordApi } from '../../src/lib/passwordApi';
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
  hash: 'usr0000001',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Lets a test hold the resend request open to observe the in-flight UI state.
function deferredResend() {
  type Result = Awaited<ReturnType<typeof AuthApi.resendVerification>>;
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderAccount(user: AuthUser | null) {
  const value: AuthContextValue = {
    status: 'authenticated',
    user,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  const { container } = render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <AccountPage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { container };
}

describe('AccountPage', () => {
  it('shows the profile name in an editable field and the email as text', () => {
    renderAccount(ada);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada');
    expect(screen.getByText('ada@example.com')).toBeTruthy();
  });

  // Logging out lives in the left menu, which is present on every page — the account
  // page no longer repeats it.
  it('offers no log out control', () => {
    renderAccount(ada);

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
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

  it('shows a busy spinner on the resend button while the request runs', async () => {
    const pending = deferredResend();
    vi.spyOn(AuthApi, 'resendVerification').mockReturnValue(pending.promise);
    renderAccount(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    const button = screen.getByRole('button', { name: 'Resend verification e-mail' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    pending.resolve({ ok: true });

    expect(await screen.findByText('Verification link sent. Check your inbox.')).toBeTruthy();
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('states a verified email and offers no resend control', () => {
    renderAccount({ ...ada, emailVerifiedAt: '2026-07-07T10:00:00Z' });

    expect(screen.getByText('Email verification')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend verification e-mail' })).toBeNull();
  });
});

// Feature 017 (FR-029). The sign-in method is the ONLY place the site tells the owner
// that a Google link was auto-attached to their pre-existing account (US3) — no e-mail
// is sent — so it is asserted per outcome rather than in one round-up.
describe('AccountPage — sign-in method', () => {
  // Reads the value paired with the term, which also asserts the row is a real dt/dd
  // pair inside the details list rather than two loose lines of text.
  function methodFor(overrides: Partial<AuthUser>): HTMLElement {
    renderAccount({ ...ada, hasPassword: true, googleLinkedAt: null, ...overrides });
    const term = screen.getByText('Sign-in method');
    return term.nextElementSibling as HTMLElement;
  }

  it('names Google alone for a passwordless linked account', () => {
    expect(methodFor({ hasPassword: false, googleLinkedAt: '2026-07-29T09:00:00Z' }).textContent)
      .toBe('Google');
  });

  it('names e-mail and password for an unlinked password account', () => {
    expect(methodFor({}).textContent).toBe('Email and password');
  });

  it('names both doors once a Google account is linked to a password account', () => {
    expect(methodFor({ googleLinkedAt: '2026-07-29T09:00:00Z' }).textContent)
      .toBe('Google and email/password');
  });

  it('falls back to e-mail and password for an account claiming neither door', () => {
    expect(methodFor({ hasPassword: false }).textContent).toBe('Email and password');
  });

  it('states the method in words, never an icon or a colour', () => {
    // Principle IV: the value is text and nothing but text — no badge element to
    // carry the meaning, so it survives a screen reader and a monochrome display.
    expect(methodFor({}).children.length).toBe(0);
  });
});

// Feature 022 (US3, FR-025/FR-026): the deliberate half of password management lives on
// the page the owner already has, directly under the name editor — no new address, no new
// guard, and two independent sections that cannot disturb each other.
describe('AccountPage — password section', () => {
  it('renders the password section directly after the name section', () => {
    const { container } = renderAccount({ ...ada, hasPassword: true });

    const name = container.querySelector('.account__name');
    expect(name).not.toBeNull();
    expect((name as HTMLElement).nextElementSibling?.className).toContain('account__password');
  });

  it('offers the current-password field for an account that has one', () => {
    renderAccount({ ...ada, hasPassword: true });

    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save password' })).toBeTruthy();
  });

  it('drops the current-password field for a Google-only account', () => {
    renderAccount({ ...ada, hasPassword: false, googleLinkedAt: '2026-07-29T09:00:00Z' });

    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });

  it('keeps the outcome of each section to itself', async () => {
    vi.spyOn(AuthApi, 'updateName').mockResolvedValue({ ok: false, kind: 'network' });
    vi.spyOn(PasswordApi, 'changePassword').mockResolvedValue({ ok: true, user: { ...ada, hasPassword: true } });
    renderAccount({ ...ada, hasPassword: true });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPassw0rd' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassw0rd' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassw0rd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText('Password updated.')).toBeTruthy();
    // The name section's refusal and its typed draft both survive the neighbour's success.
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Grace');
  });
});
