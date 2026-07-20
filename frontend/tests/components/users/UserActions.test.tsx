// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserActions from '../../../src/components/users/UserActions';
import { UserAdminApi } from '../../../src/lib/userAdminApi';
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

// The control lives inside a table row in production; render it in that shape.
function renderInRow(row: Row, onApply: (updated: Row) => void = () => {}) {
  return render(
    <table>
      <tbody>
        <tr>
          <td>
            <UserActions row={row} onApply={onApply} />
          </td>
        </tr>
      </tbody>
    </table>,
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
