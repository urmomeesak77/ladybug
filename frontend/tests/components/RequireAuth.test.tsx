// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireAuth from '../../src/components/RequireAuth';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthStatus } from '../../src/lib/authModel';

afterEach(cleanup);

function renderGate(status: AuthStatus) {
  const value: AuthContextValue = {
    status,
    user: null,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<p>login form</p>} />
          <Route path="/account" element={<RequireAuth><p>account details</p></RequireAuth>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  it('renders the protected view for authenticated users', () => {
    renderGate('authenticated');

    expect(screen.getByText('account details')).toBeTruthy();
  });

  it('renders nothing while the session check is in flight (no login flash)', () => {
    renderGate('unknown');

    expect(screen.queryByText('account details')).toBeNull();
    expect(screen.queryByText('login form')).toBeNull();
  });

  it('sends anonymous visitors to the login page', () => {
    renderGate('anonymous');

    expect(screen.getByText('login form')).toBeTruthy();
  });
});
