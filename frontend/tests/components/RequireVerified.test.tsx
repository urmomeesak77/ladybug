// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireVerified from '../../src/components/RequireVerified';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(cleanup);

function makeUser(emailVerifiedAt: string | null): AuthUser {
  return {
    hash: 'usr0000001',
    name: 'Uploader',
    email: 'uploader@example.com',
    emailVerifiedAt,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

function renderGate(user: AuthUser | null) {
  const value: AuthContextValue = {
    status: 'authenticated',
    user,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/upload']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/verify-email" element={<p>verify notice</p>} />
          <Route path="/upload" element={<RequireVerified><p>upload form</p></RequireVerified>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequireVerified', () => {
  it('renders the protected view for a verified user', () => {
    renderGate(makeUser('2026-07-08T00:00:00Z'));

    expect(screen.getByText('upload form')).toBeTruthy();
  });

  it('redirects an unverified user to the verify notice', () => {
    renderGate(makeUser(null));

    expect(screen.getByText('verify notice')).toBeTruthy();
    expect(screen.queryByText('upload form')).toBeNull();
  });

  it('renders nothing without a user (mounted outside RequireAuth)', () => {
    renderGate(null);

    expect(screen.queryByText('upload form')).toBeNull();
    expect(screen.queryByText('verify notice')).toBeNull();
  });
});
