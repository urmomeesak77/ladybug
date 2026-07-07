// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser, VerifyEmailResult } from '../../src/lib/authApi';
import VerifyEmailPage from '../../src/pages/VerifyEmailPage';

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

const verifiedAda: AuthUser = { ...ada, emailVerifiedAt: '2026-07-07T10:00:00Z' };

const linkUrl = '/verify-email/abc123?expires=1767225600&signature=deadbeef';

function landingTree(initialEntry: string, refresh: () => Promise<void>) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthContext.Provider
        value={{
          status: 'authenticated',
          user: ada,
          register: vi.fn(),
          login: vi.fn(),
          logout: vi.fn(),
          refresh,
        } satisfies AuthContextValue}
      >
        <NoticeProvider>
          <Routes>
            <Route path="/verify-email/:hash" element={<VerifyEmailPage />} />
          </Routes>
        </NoticeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

function renderLanding(initialEntry = linkUrl) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(landingTree(initialEntry, refresh));
  return refresh;
}

describe('VerifyEmailPage', () => {
  it('shows progress text while the verification request is in flight', () => {
    // A promise that never settles keeps the page in the verifying state.
    vi.spyOn(AuthApi, 'verifyEmail').mockReturnValue(new Promise<VerifyEmailResult>(() => undefined));

    renderLanding();

    expect(screen.getByRole('status').textContent).toMatch(/verifying/i);
  });

  it('confirms a fresh verification and refreshes the auth context', async () => {
    const verify = vi.spyOn(AuthApi, 'verifyEmail')
      .mockResolvedValue({ ok: true, user: verifiedAda, alreadyVerified: false });

    const refresh = renderLanding();

    expect(await screen.findByText(/your e-mail is verified/i)).toBeTruthy();
    expect(verify).toHaveBeenCalledWith({
      hash: 'abc123',
      expires: '1767225600',
      signature: 'deadbeef',
    });
    // emailVerifiedAt must propagate everywhere the SPA shows status.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('reports an already-verified account as information, not an error', async () => {
    vi.spyOn(AuthApi, 'verifyEmail')
      .mockResolvedValue({ ok: true, user: verifiedAda, alreadyVerified: true });

    const refresh = renderLanding();

    // FR-005: re-using a link is a friendly no-op.
    expect(await screen.findByText(/already verified/i)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports an invalid or expired link on 403', async () => {
    vi.spyOn(AuthApi, 'verifyEmail').mockResolvedValue({ ok: false, kind: 'invalid' });

    renderLanding();

    expect(await screen.findByText(/invalid or expired/i)).toBeTruthy();
  });

  it('offers a resend action in the failed state (FR-004)', async () => {
    vi.spyOn(AuthApi, 'verifyEmail').mockResolvedValue({ ok: false, kind: 'invalid' });
    vi.spyOn(AuthApi, 'resendVerification').mockResolvedValue({ ok: true });

    renderLanding();
    await screen.findByText(/invalid or expired/i);

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification e-mail' }));

    expect(await screen.findByText('Verification link sent. Check your inbox.')).toBeTruthy();
  });

  it('does not offer a resend action after a successful verification', async () => {
    vi.spyOn(AuthApi, 'verifyEmail')
      .mockResolvedValue({ ok: true, user: verifiedAda, alreadyVerified: false });

    renderLanding();
    await screen.findByText(/your e-mail is verified/i);

    expect(screen.queryByRole('button', { name: 'Resend verification e-mail' })).toBeNull();
  });

  it('tells a rate-limited user to try again in a minute', async () => {
    vi.spyOn(AuthApi, 'verifyEmail').mockResolvedValue({ ok: false, kind: 'rate-limited' });

    renderLanding();

    expect(await screen.findByText(/try again in a minute/i)).toBeTruthy();
  });

  it('renders the failure state for malformed params without issuing a request', async () => {
    const verify = vi.spyOn(AuthApi, 'verifyEmail');

    renderLanding('/verify-email/abc123?expires=1767225600'); // signature missing

    expect(await screen.findByText(/invalid or expired/i)).toBeTruthy();
    expect(verify).not.toHaveBeenCalled();
  });

  it('verifies exactly once even when StrictMode re-runs the mount effect', async () => {
    // Seen live in e2e (Vite dev build): the duplicated mount effect issued a second
    // request whose already_verified=true answer overwrote the fresh confirmation.
    const verify = vi.spyOn(AuthApi, 'verifyEmail')
      .mockResolvedValueOnce({ ok: true, user: verifiedAda, alreadyVerified: false })
      .mockResolvedValue({ ok: true, user: verifiedAda, alreadyVerified: true });
    const refresh = vi.fn().mockResolvedValue(undefined);

    render(<StrictMode>{landingTree(linkUrl, refresh)}</StrictMode>);

    expect(await screen.findByText(/your e-mail is verified/i)).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('announces the outcome in a live region (a11y)', async () => {
    vi.spyOn(AuthApi, 'verifyEmail')
      .mockResolvedValue({ ok: true, user: verifiedAda, alreadyVerified: false });

    renderLanding();

    await screen.findByText(/your e-mail is verified/i);
    // role=status implies aria-live=polite: outcome changes are announced.
    expect(screen.getByRole('status').textContent).toMatch(/verified/i);
  });
});
