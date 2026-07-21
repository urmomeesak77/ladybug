// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../../src/components/NoticeProvider';
import UserActions from '../../../src/components/users/UserActions';
import { AuthContext } from '../../../src/hooks/useAuth';
import type { AuthContextValue } from '../../../src/hooks/useAuth';
import { UserAdminApi } from '../../../src/lib/userAdminApi';
import type { RoleName } from '../../../src/lib/role';
import type { UserRow as Row } from '../../../src/lib/userAdminModel';

// ConfirmDialog opens via <dialog>.showModal, which jsdom does not implement.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

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
// the viewer's role from useAuth to mirror the server's rank guard) and the NoticeProvider
// (the delete confirmation is raised app-level via useNotice). Default viewer is an admin, who
// outranks a member row so the menu renders.
function renderInRow(
  row: Row,
  handlers: { onApply?: (updated: Row) => void; onRemove?: (hash: string) => void } = {},
  viewerRole: RoleName = 'admin',
) {
  const onApply = handlers.onApply ?? (() => {});
  const onRemove = handlers.onRemove ?? (() => {});
  return render(
    <AuthContext.Provider value={authValue(viewerRole)}>
      <NoticeProvider>
        <table>
          <tbody>
            <tr>
              <td>
                <UserActions row={row} onApply={onApply} onRemove={onRemove} />
              </td>
            </tr>
          </tbody>
        </table>
      </NoticeProvider>
    </AuthContext.Provider>,
  );
}

// Open the row's kebab menu — the trigger is the only plain button when the menu is closed.
function openMenu(): void {
  fireEvent.click(screen.getByRole('button'));
}

describe('UserActions menu', () => {
  it('gathers the account actions behind a single kebab trigger, closed by default', () => {
    renderInRow(active);

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    // Nothing is exposed until the menu opens.
    expect(screen.queryByRole('menuitem', { name: /disable/i })).toBeNull();
  });

  it('offers Disable plus Delete permanently for an active, outranked account', () => {
    renderInRow(active);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^disable$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^enable$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^delete permanently$/i })).toBeTruthy();
  });

  it('offers Enable (not Disable) plus Delete permanently for a disabled account', () => {
    renderInRow(disabled);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^enable$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^disable$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^delete permanently$/i })).toBeTruthy();
  });

  it('gives Delete permanently destructive emphasis while keeping its text label (FR-002)', () => {
    renderInRow(active);
    openMenu();

    const item = screen.getByRole('menuitem', { name: /^delete permanently$/i });
    // Colour/weight is additive: the class carries emphasis, the label always carries meaning.
    expect(item.className).toContain('action-menu__item--danger');
    expect(item.textContent).toContain('Delete permanently');
  });
});

describe('UserActions enable/disable (unchanged behaviour, FR-014)', () => {
  it('disables the account and applies the returned row', async () => {
    const updated: Row = { ...active, disabledAt: '2026-07-20 10:00:00', disabledBy: 'Root', isDisabled: true };
    const disableCall = vi.spyOn(UserAdminApi, 'disable').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();
    renderInRow(active, { onApply });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^disable$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(disableCall).toHaveBeenCalledWith(active.hash);
  });

  it('enables a disabled account', async () => {
    const updated: Row = { ...disabled, disabledAt: null, disabledBy: null, isDisabled: false };
    vi.spyOn(UserAdminApi, 'enable').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();
    renderInRow(disabled, { onApply });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^enable$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
  });

  it('leaves the row untouched when the enable/disable action fails', async () => {
    vi.spyOn(UserAdminApi, 'disable').mockResolvedValue({ ok: false });
    const onApply = vi.fn();
    renderInRow(active, { onApply });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^disable$/i }));

    await waitFor(() => expect(UserAdminApi.disable).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('UserActions permanent delete', () => {
  it('confirms via a naming dialog and only deletes on confirm, dropping the row on 204 (D8)', async () => {
    const destroy = vi.spyOn(UserAdminApi, 'destroy').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();
    renderInRow(active, { onRemove });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));

    // Nothing is sent until the modal is answered; the copy names the account (FR-008).
    expect(destroy).not.toHaveBeenCalled();
    expect(screen.getByText(/Ada/)).toBeTruthy();

    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete permanently$/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(active.hash));
    expect(destroy).toHaveBeenCalledWith(active.hash);
  });

  it('cancels without deleting anything (FR-008)', () => {
    const destroy = vi.spyOn(UserAdminApi, 'destroy').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();
    renderInRow(active, { onRemove });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(destroy).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('leaves the row in place when the delete fails, incl. a 404 concurrent delete (D8)', async () => {
    vi.spyOn(UserAdminApi, 'destroy').mockResolvedValue({ ok: false });
    const onRemove = vi.fn();
    renderInRow(active, { onRemove });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete permanently$/i }));

    await waitFor(() => expect(UserAdminApi.destroy).toHaveBeenCalled());
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe('UserActions rank guard (research D6)', () => {
  const adminRow: Row = { ...active, role: 'admin' };
  const superuserRow: Row = { ...active, role: 'superuser' };

  it('renders no menu for a peer of equal rank, only the "No permission" text', () => {
    renderInRow(adminRow, {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/no permission/i)).toBeTruthy();
  });

  it('renders no menu for a higher rank', () => {
    renderInRow(superuserRow, {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/no permission/i)).toBeTruthy();
  });

  it("renders no menu on the viewer's own equal-rank row", () => {
    // The viewer's own account carries the viewer's role, so the strict-rank check removes the
    // menu exactly as it does for any peer — no separate self check is needed.
    renderInRow(adminRow, {}, 'admin');

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the menu for a strictly lower rank', () => {
    renderInRow(active, {}, 'admin');

    expect(screen.getByRole('button')).toBeTruthy();
  });
});
