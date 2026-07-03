// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RequireAnon from '../../src/components/RequireAnon';
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
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/" element={<p>home feed</p>} />
          <Route path="/login" element={<RequireAnon><p>login form</p></RequireAnon>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
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
});
