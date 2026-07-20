// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import UserTable from '../../../src/components/users/UserTable';
import type { UserRow as Row } from '../../../src/lib/userAdminModel';

afterEach(cleanup);

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
    const { container } = render(<UserTable rows={[row]} />);

    expect(container.querySelector('caption')).toBeTruthy();
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(7);
  });

  it('renders one row per account', () => {
    render(<UserTable rows={[row, rowB]} />);

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Spammer')).toBeTruthy();
  });

  it('wraps the wide table in an overflow-x scroll container so the page never scrolls sideways', () => {
    const { container } = render(<UserTable rows={[row]} />);

    const scroll = container.querySelector('.user-table__scroll');
    expect(scroll).toBeTruthy();
    expect(scroll?.querySelector('table')).toBeTruthy();
  });
});
