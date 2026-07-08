// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireAnon from '../../src/components/RequireAnon';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthStatus } from '../../src/lib/authModel';

afterEach(cleanup);

function contextValue(status: AuthStatus): AuthContextValue {
  return {
    status,
    user: null,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
}

function gateTree(status: AuthStatus) {
  return (
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={contextValue(status)}>
        <Routes>
          <Route path="/" element={<p>home feed</p>} />
          <Route path="/login" element={<RequireAnon><p>login form</p></RequireAnon>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

function renderGate(status: AuthStatus) {
  return render(gateTree(status));
}

describe('RequireAnon', () => {
  it('renders the anonymous-only view for anonymous visitors', () => {
    renderGate('anonymous');

    expect(screen.getByText('login form')).toBeTruthy();
  });

  it('renders nothing while the session check is in flight', () => {
    renderGate('unknown');

    expect(screen.queryByText('login form')).toBeNull();
    expect(screen.queryByText('home feed')).toBeNull();
  });

  it('sends authenticated users home', () => {
    renderGate('authenticated');

    expect(screen.getByText('home feed')).toBeTruthy();
  });

  it('does not hijack an in-page authentication — the page owns that navigation', () => {
    // When login/register succeeds ON this page, the page navigates itself (e.g.
    // register → /verify-email, login → the guard-blocked location). A competing
    // guard redirect races that navigation and can win (seen live in e2e), so once
    // the form was shown to an anonymous visitor the guard must stay out of it.
    const { rerender } = renderGate('anonymous');
    expect(screen.getByText('login form')).toBeTruthy();

    rerender(gateTree('authenticated'));

    expect(screen.queryByText('home feed')).toBeNull();
    expect(screen.getByText('login form')).toBeTruthy();
  });
});
