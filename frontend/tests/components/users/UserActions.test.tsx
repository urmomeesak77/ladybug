// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserActions from '../../../src/components/users/UserActions';
import { AuthContext } from '../../../src/hooks/useAuth';
import type { AuthContextValue } from '../../../src/hooks/useAuth';
import { UserAdminApi } from '../../../src/lib/userAdminApi';
import type { RoleName } from '../../../src/lib/role';
import type { UserRow as Row } from '../../../src/lib/userAdminModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const active: Row = {
  hash: 'a1B2c3D4e5',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'member',
  emailVerifiedAt: null,
  createdAt: null,
  disabledAt: null,
  disabledBy: null,
  isDisabled: false,
};

const disabled: Row = { ...active, disabledAt: '2026-07-19 11:20:00', disabledBy: 'Root', isDisabled: true };

function authValue(role: RoleName): AuthContextValue {
  return {
    status: 'authenticated',
    user: null,
    role,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
}

// The control lives inside a table row in production, under the app's auth context (it reads
// the viewer's role from useAuth to mirror the server's rank guard). Default viewer is an
// admin, who outranks a member row so the control renders.
function renderInRow(row: Row, onApply: (updated: Row) => void = () => {}, viewerRole: RoleName = 'admin') {
  return render(
    <AuthContext.Provider value={authValue(viewerRole)}>
      <table>
        <tbody>
          <tr>
            <td>
              <UserActions row={row} onApply={onApply} />
            </td>
          </tr>
        </tbody>
      </table>
    </AuthContext.Provider>,
  );
}

describe('UserActions', () => {
  it('offers exactly a Disable control for an active account', () => {
    renderInRow(active);

    expect(screen.getByRole('button', { name: /^disable$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^enable$/i })).toBeNull();
  });

  it('offers exactly an Enable control for a disabled account', () => {
    renderInRow(disabled);

    expect(screen.getByRole('button', { name: /^enable$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^disable$/i })).toBeNull();
  });

  it('disables the account in a single click with no confirmation and applies the returned row', async () => {
    const updated: Row = { ...active, disabledAt: '2026-07-20 10:00:00', disabledBy: 'Root', isDisabled: true };
    const disableCall = vi.spyOn(UserAdminApi, 'disable').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();
    renderInRow(active, onApply);

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(disableCall).toHaveBeenCalledWith(active.hash);
  });

  it('enables a disabled account in a single click', async () => {
    const updated: Row = { ...disabled, disabledAt: null, disabledBy: null, isDisabled: false };
    vi.spyOn(UserAdminApi, 'enable').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();
    renderInRow(disabled, onApply);

    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
  });

  it('leaves the row untouched when the action fails (never paints unconfirmed state)', async () => {
    vi.spyOn(UserAdminApi, 'disable').mockResolvedValue({ ok: false });
    const onApply = vi.fn();
    renderInRow(active, onApply);

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));

    await waitFor(() => expect(UserAdminApi.disable).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables the button while the request is in flight', async () => {
    let resolve!: (result: { ok: true; row: Row }) => void;
    vi.spyOn(UserAdminApi, 'disable').mockReturnValue(new Promise((r) => {
      resolve = r;
    }));
    renderInRow(active);
    const button = screen.getByRole('button', { name: /^disable$/i }) as HTMLButtonElement;

    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    resolve({ ok: true, row: { ...active, isDisabled: true } });
  });
});

describe('UserActions rank guard (research D6)', () => {
  const adminRow: Row = { ...active, role: 'admin' };
  const superuserRow: Row = { ...active, role: 'superuser' };

  it('renders no control for a peer of equal rank, only a short reason', () => {
    renderInRow(adminRow, () => {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/no permission/i)).toBeTruthy();
  });

  it('renders no control for a higher rank', () => {
    renderInRow(superuserRow, () => {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/no permission/i)).toBeTruthy();
  });

  it("renders no control on the viewer's own equal-rank row", () => {
    // The viewer's own account carries the viewer's role, so the strict-rank check removes
    // the control exactly as it does for any peer — no separate self check is needed.
    renderInRow(adminRow, () => {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still renders the control for a strictly lower rank', () => {
    renderInRow(active, () => {}, 'admin');

    expect(screen.getByRole('button', { name: /^disable$/i })).toBeTruthy();
  });
});
