// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import NoticeProvider from '../../../src/components/NoticeProvider';
import UserTable from '../../../src/components/users/UserTable';
import { AuthContext } from '../../../src/hooks/useAuth';
import type { AuthContextValue } from '../../../src/hooks/useAuth';
import type { UserRow as Row } from '../../../src/lib/userAdminModel';

afterEach(cleanup);

// UserTable → UserRow → UserActions reads the viewer's role from useAuth; a superuser
// outranks every row so each action control renders under this provider.
const auth = {
  status: 'authenticated',
  user: null,
  role: 'superuser',
  register: () => {},
  login: () => {},
  logout: () => {},
  refresh: () => {},
} as unknown as AuthContextValue;

function renderTable(rows: Row[]) {
  return render(
    <AuthContext.Provider value={auth}>
      <NoticeProvider>
        <UserTable rows={rows} onApply={() => {}} onRemove={() => {}} />
      </NoticeProvider>
    </AuthContext.Provider>,
  );
}

const row: Row = {
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

const rowB: Row = { ...row, hash: 'Zz9Yy8Xx7w', name: 'Spammer' };

describe('UserTable', () => {
  it('renders a captioned table with seven column headers', () => {
    const { container } = renderTable([row]);

    expect(container.querySelector('caption')).toBeTruthy();
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(7);
  });

  it('renders one row per account', () => {
    renderTable([row, rowB]);

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Spammer')).toBeTruthy();
  });

  it('renders the table directly, with no dedicated scroll container of its own', () => {
    const { container } = renderTable([row]);

    expect(container.querySelector('.user-table__scroll')).toBeNull();
    expect(container.querySelector('table.user-table')).toBeTruthy();
  });
});
