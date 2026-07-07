// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';
import VerifyEmailNoticePage from '../../src/pages/VerifyEmailNoticePage';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

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
  });
});
