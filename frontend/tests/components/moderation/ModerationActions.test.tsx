// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ModerationActions from '../../../src/components/moderation/ModerationActions';
import NoticeProvider from '../../../src/components/NoticeProvider';
import { ModerationApi } from '../../../src/lib/moderationApi';
import type { ModerationRow as Row } from '../../../src/lib/moderationModel';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const activated: Row = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08 20:14:02',
  activatedAt: '2026-07-09 08:01:10',
  deletedAt: null,
};

const inactive: Row = { ...activated, activatedAt: null };
const deletedRow: Row = { ...inactive, deletedAt: '2026-07-09 09:30:00' };

// The actions cell lives inside a table row in production, next to (not nested in) the
// title link; render it in that shape so the markup matches reality.
function renderInRow(
  row: Row,
  onApply: (updated: Row) => void = () => {},
  onRemove: (hash: string) => void = () => {},
) {
  return render(
    <NoticeProvider>
      <table>
        <tbody>
          <tr>
            <td>
              <ModerationActions row={row} onApply={onApply} onRemove={onRemove} />
            </td>
          </tr>
        </tbody>
      </table>
    </NoticeProvider>,
  );
}

// Open the row's kebab menu — the trigger is the only plain button when the menu is closed.
function openMenu(): void {
  fireEvent.click(screen.getByRole('button'));
}

describe('ModerationActions menu shape (FR-015/FR-016)', () => {
  it('gathers the row actions behind a single kebab trigger, closed by default', () => {
    renderInRow(inactive);

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('offers Activate, Soft delete and Delete permanently for an inactive live meme', () => {
    renderInRow(inactive);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^activate$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^soft delete$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete permanently$/i })).toBeTruthy();
    // No Restore for a live meme.
    expect(screen.queryByRole('menuitem', { name: /^restore$/i })).toBeNull();
  });

  it('offers Deactivate (not Activate) for an activated meme', () => {
    renderInRow(activated);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^soft delete$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete permanently$/i })).toBeTruthy();
  });

  it('offers Restore and Delete permanently only for a soft-deleted meme (FR-016)', () => {
    renderInRow(deletedRow);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete permanently$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^soft delete$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
  });

  it('shows each menu item as an icon together with a text label (FR-015)', () => {
    renderInRow(inactive);
    openMenu();

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(item.textContent?.trim()).not.toBe('');
    }
  });
});

describe('ModerationActions activation (unchanged behaviour, FR-017)', () => {
  it('activates then applies the updated row', async () => {
    const updated = { ...inactive, activatedAt: '2026-07-09 08:01:10' };
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^activate$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.activate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('deactivates an activated meme', async () => {
    const updated = { ...activated, activatedAt: null };
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(activated, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.deactivate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('leaves the row unchanged when activation fails', async () => {
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^activate$/i }));

    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('restores a soft-deleted meme on a single click (no confirmation)', async () => {
    const updated = { ...deletedRow, deletedAt: null };
    vi.spyOn(ModerationApi, 'restore').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(deletedRow, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^restore$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.restore).toHaveBeenCalledWith('Ab3-_9xQ12');
  });
});

describe('ModerationActions deletion confirmations (unchanged, FR-017)', () => {
  it("a live meme's Soft delete raises the existing soft-vs-permanent confirm and soft-deletes on choice", async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^soft delete$/i }));

    // The existing live-meme confirm: title + both outcomes explained.
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(within(dialog).getByRole('button', { name: 'Soft delete' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete permanently' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Soft delete' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.purge).not.toHaveBeenCalled();
  });

  it("a live meme's Delete permanently raises the SAME soft-vs-permanent confirm (FR-017) and purges on the permanent choice", async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();

    renderInRow(inactive, () => {}, onRemove);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));

    // A live meme always gets the soft-vs-permanent choice — the confirmation is unchanged.
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.remove).not.toHaveBeenCalled();
  });

  it('a soft-deleted meme gets the permanent-only confirm (no soft-delete choice) and purges on confirm', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();

    renderInRow(deletedRow, () => {}, onRemove);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));

    expect(screen.getByRole('heading', { name: 'Delete post permanently?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(within(dialog).queryByRole('button', { name: 'Soft delete' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('cancels a pending delete without sending anything, closing the modal', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });

    renderInRow(inactive);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^soft delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(ModerationApi.purge).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('keeps the row when the purge fails (D8)', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onRemove = vi.fn();

    renderInRow(deletedRow, () => {}, onRemove);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete permanently$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await Promise.resolve();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('falls back to "this post" copy when the row has no title', () => {
    renderInRow({ ...inactive, title: null });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^soft delete$/i }));

    expect(
      screen.getByText(
        'Soft delete hides this post from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();
  });
});
