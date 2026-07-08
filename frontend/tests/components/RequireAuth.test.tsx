// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireAuth from '../../src/components/RequireAuth';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthStatus } from '../../src/lib/authModel';

afterEach(cleanup);

// Surfaces the location the guard forwarded via router state (research D9).
function FromProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from;
  return <output data-testid="from">{from ? `${from.pathname}${from.search}` : ''}</output>;
}

function renderGate(status: AuthStatus, initialEntry = '/account') {
  const value: AuthContextValue = {
    status,
    user: null,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<><p>login form</p><FromProbe /></>} />
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

  it('passes the blocked location to the login page so login can return there', () => {
    // The blocked URL — query string included — must survive the sign-in
    // round-trip (research D9).
    renderGate('anonymous', '/account?tab=uploads');

    expect(screen.getByText('login form')).toBeTruthy();
    expect(screen.getByTestId('from').textContent).toBe('/account?tab=uploads');
  });
});
