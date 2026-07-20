// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import UserRow from '../../../src/components/users/UserRow';
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

function renderRow(value: Row) {
  return render(
    <table>
      <tbody>
        <UserRow row={value} onApply={() => {}} />
      </tbody>
    </table>,
  );
}

describe('UserRow', () => {
  it('renders all seven cells', () => {
    const { container } = renderRow(row);

    expect(container.querySelectorAll('td')).toHaveLength(7);
  });

  it('shows the name, email and role', () => {
    renderRow(row);

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('member')).toBeTruthy();
  });

  it('conveys the verified state in text, not colour alone (FR-005)', () => {
    renderRow(row);

    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('conveys the not-verified state in text', () => {
    renderRow({ ...row, emailVerifiedAt: null });

    expect(screen.getByText('Not verified')).toBeTruthy();
  });

  it('shows only the date part of created, with the full datetime as a tooltip', () => {
    renderRow(row);

    const created = screen.getByText('2026-07-18');
    expect(created.getAttribute('title')).toBe('2026-07-18 09:30:44');
  });

  it('leaves the disabled cell empty for an active account', () => {
    const { container } = renderRow(row);

    const disabledCell = container.querySelector('td.user-disabled');
    expect(disabledCell?.textContent).toBe('');
    expect(disabledCell?.hasAttribute('title')).toBe(false);
  });

  it('shows the disabled timestamp and the acting account name for a disabled row', () => {
    renderRow({ ...row, disabledAt: '2026-07-19 11:20:00', disabledBy: 'Root', isDisabled: true });

    expect(screen.getByText('2026-07-19 by Root')).toBeTruthy();
  });

  it('degrades a disabled row to the timestamp alone when the actor is unresolvable', () => {
    const { container } = renderRow({ ...row, disabledAt: '2026-07-19 11:20:00', disabledBy: null, isDisabled: true });

    const disabledCell = container.querySelector('td.user-disabled');
    expect(disabledCell?.textContent).toBe('2026-07-19');
    // The full timestamp stays available as the cell tooltip.
    expect(disabledCell?.getAttribute('title')).toBe('2026-07-19 11:20:00');
  });
});
