// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireRole from '../../src/components/RequireRole';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthStatus } from '../../src/lib/authModel';
import type { RoleName } from '../../src/lib/role';

afterEach(cleanup);

function renderGate(status: AuthStatus, role: RoleName) {
  const value: AuthContextValue = {
    status,
    user: null,
    role,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={['/admin/memes']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route
            path="/admin/memes"
            element={<RequireRole role="admin"><p>moderation table</p></RequireRole>}
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('renders the protected view at the exact minimum role', () => {
    renderGate('authenticated', 'admin');

    expect(screen.getByText('moderation table')).toBeTruthy();
  });

  it('renders the protected view for a role above the minimum', () => {
    renderGate('authenticated', 'superuser');

    expect(screen.getByText('moderation table')).toBeTruthy();
  });

  it('redirects a member below the minimum to home', () => {
    renderGate('authenticated', 'member');

    expect(screen.getByText('home page')).toBeTruthy();
    expect(screen.queryByText('moderation table')).toBeNull();
  });

  it('redirects a guest to home', () => {
    renderGate('anonymous', 'guest');

    expect(screen.getByText('home page')).toBeTruthy();
    expect(screen.queryByText('moderation table')).toBeNull();
  });

  it('renders nothing while the session check is in flight (no flash)', () => {
    // Mirrors RequireAuth: an unresolved session must not flash the redirect
    // before the role is known.
    renderGate('unknown', 'guest');

    expect(screen.queryByText('moderation table')).toBeNull();
    expect(screen.queryByText('home page')).toBeNull();
  });
});
