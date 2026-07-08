// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser, ResendResult } from '../../src/lib/authApi';
import VerifyEmailNoticePage from '../../src/pages/VerifyEmailNoticePage';

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

function renderNotice(user: AuthUser) {
  const value: AuthContextValue = {
    status: 'authenticated',
    user,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <AuthContext.Provider value={value}>
        <NoticeProvider>
          <VerifyEmailNoticePage />
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('VerifyEmailNoticePage', () => {
  it("names the signed-in user's address in the notice text", () => {
    renderNotice(ada);

    // The address is stated in text (Principle IV — never conveyed another way).
    expect(screen.getByText(/ada@example\.com/)).toBeTruthy();
    expect(screen.getByText(/check your inbox/i)).toBeTruthy();
  });

  it('tells an already-verified visitor so and links to the account page instead', () => {
    renderNotice({ ...ada, emailVerifiedAt: '2026-07-07T10:00:00Z' });

    // Visiting the notice URL later must not mislead a verified user (FR-010).
    expect(screen.getByText(/already verified/i)).toBeTruthy();
    expect(screen.queryByText(/check your inbox/i)).toBeNull();
    const link = screen.getByRole('link', { name: /account/i });
    expect(link.getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('button', { name: 'Resend verification e-mail' })).toBeNull();
  });

  it('announces a successful resend', async () => {
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: true });
    renderNotice(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    expect(await screen.findByText('Verification link sent. Check your inbox.')).toBeTruthy();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('announces an already-verified answer to a resend', async () => {
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: false, kind: 'already-verified' });
    renderNotice(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    expect(await screen.findByText('Your e-mail is already verified.')).toBeTruthy();
  });

  it('tells a rate-limited user to try again in a minute (SC-005)', async () => {
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: false, kind: 'rate-limited' });
    renderNotice(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    expect(await screen.findByText('Too many attempts. Please try again in a minute.')).toBeTruthy();
  });

  it('reports a network failure on resend as retryable', async () => {
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: false, kind: 'network' });
    renderNotice(ada);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    expect(await screen.findByText('Something went wrong. Please check your connection and try again.'))
      .toBeTruthy();
  });

  it('disables the resend button and shows a busy spinner while the request is in flight', async () => {
    vi.spyOn(AuthApi, 'resendVerification')
      .mockReturnValue(new Promise<ResendResult>(() => undefined));
    renderNotice(ada);
    const button = screen.getByRole('button', { name: 'Resend verification e-mail' });

    fireEvent.click(button);

    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
  });
});
