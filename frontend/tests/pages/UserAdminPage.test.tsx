// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserAdminPage from '../../src/pages/UserAdminPage';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { UserRow } from '../../src/lib/userAdminModel';

// The page's rows render UserActions, which reads the viewer's role from useAuth; a superuser
// outranks every row so the controls render under this provider.
const auth = {
  status: 'authenticated',
  user: null,
  role: 'superuser',
  register: () => {},
  login: () => {},
  logout: () => {},
  refresh: () => {},
} as unknown as AuthContextValue;

const useUserAdminMock = vi.fn();

vi.mock('../../src/hooks/useUserAdmin', () => ({
  useUserAdmin: () => useUserAdminMock(),
}));

afterEach(cleanup);

const row: UserRow = {
  hash: 'a1B2c3D4e5',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'member',
  emailVerifiedAt: '2026-07-18 09:31:02',
  createdAt: '2026-07-18 09:30:44',
  disabledAt: null,
  disabledBy: null,
  isDisabled: false,
};

const meta = { current_page: 1, last_page: 2, per_page: 100, total: 130 };

function renderPage(initialPath = '/admin/users') {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[initialPath]}>
        <UserAdminPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('UserAdminPage', () => {
  it('renders the table and pagination once loaded', () => {
    useUserAdminMock.mockReturnValue({
      rows: [row], meta, loading: false, empty: false, failed: false, retry: vi.fn(), applyRow: vi.fn(),
    });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    // The page links reflect ?page=N (Principle III).
    expect(container.querySelector('nav a')).toBeTruthy();
  });

  it('renders an explicit no-accounts state for an empty list (FR-017)', () => {
    useUserAdminMock.mockReturnValue({
      rows: [], meta: null, loading: false, empty: true, failed: false, retry: vi.fn(), applyRow: vi.fn(),
    });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText(/no accounts/i)).toBeTruthy();
  });

  it('shows a loading indicator while the page is in flight', () => {
    useUserAdminMock.mockReturnValue({
      rows: [], meta: null, loading: true, empty: false, failed: false, retry: vi.fn(), applyRow: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('renders an error state with retry on a failed fetch, never the empty message', () => {
    useUserAdminMock.mockReturnValue({
      rows: [], meta: null, loading: false, empty: false, failed: true, retry: vi.fn(), applyRow: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.queryByText(/no accounts/i)).toBeNull();
  });
});
