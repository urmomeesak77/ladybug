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

// The actions cell lives inside a table row in production, next to (not nested in) the
// title link; render it in that shape so the markup matches reality.
function renderInRow(
  row: Row,
  onApply: (updated: Row) => void,
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

describe('ModerationActions activation control', () => {
  it('renders the Activate control as an icon button (aria-label + title, no visible text)', () => {
    renderInRow(inactive, () => {});

    const button = screen.getByRole('button', { name: /^activate$/i });
    expect(button.getAttribute('title')).toBe('Activate');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('offers Activate for an inactive meme (and only that)', () => {
    renderInRow(inactive, () => {});

    expect(screen.getByRole('button', { name: /^activate$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^deactivate$/i })).toBeNull();
  });

  it('offers Deactivate for an activated meme (and only that)', () => {
    renderInRow(activated, () => {});

    expect(screen.getByRole('button', { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^activate$/i })).toBeNull();
  });

  it('activates then applies the updated row', async () => {
    const updated = { ...inactive, activatedAt: '2026-07-09 08:01:10' };
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.activate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('deactivates an activated meme', async () => {
    const updated = { ...activated, activatedAt: null };
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(activated, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.deactivate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('leaves the row unchanged when the action fails', async () => {
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));

    // Give the rejected action a tick to settle; onApply must not fire on failure.
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('ModerationActions delete/restore control', () => {
  const deletedRow: Row = { ...inactive, deletedAt: '2026-07-09 09:30:00' };

  it('offers Delete for a live meme; Restore and Delete permanently for a deleted one', () => {
    renderInRow(inactive, () => {});
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^restore$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^delete permanently$/i })).toBeNull();
    cleanup();

    renderInRow(deletedRow, () => {});
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^delete permanently$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('soft-deletes through the modal and applies the updated row (FR-016)', async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Not sent yet — the modal must be answered first; the copy explains both outcomes.
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(
      screen.getByText(
        'Soft delete hides the post "A funny meme" from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Soft delete' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.purge).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('hard-deletes a live meme through the modal and removes the row', async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onApply = vi.fn();
    const onRemove = vi.fn();

    renderInRow(inactive, onApply, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('offers only permanent delete for an already-deleted meme', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();

    renderInRow(deletedRow, () => {}, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }));

    expect(screen.getByRole('heading', { name: 'Delete post permanently?' })).toBeTruthy();
    expect(
      screen.getByText(
        'The post "A funny meme" is already hidden from the site. '
          + 'Permanent delete removes it and its files forever.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Soft delete' })).toBeNull();

    // Scope to the modal: the already-deleted row's own trash button also reads
    // "Delete permanently", so pick the one inside the dialog.
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('cancels a pending delete without sending anything, closing the modal', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });

    renderInRow(inactive, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(ModerationApi.purge).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('keeps the row when the purge fails', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onRemove = vi.fn();

    renderInRow(inactive, () => {}, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    // Give the settled failure a tick; the row must not be removed.
    await Promise.resolve();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('falls back to "this post" copy when the row has no title', () => {
    renderInRow({ ...inactive, title: null }, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(
      screen.getByText(
        'Soft delete hides this post from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();
  });

  it('restores on a single click (no confirmation)', async () => {
    const updated = { ...inactive, deletedAt: null };
    vi.spyOn(ModerationApi, 'restore').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(deletedRow, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.restore).toHaveBeenCalledWith('Ab3-_9xQ12');
  });
});
