// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ModerationActions from '../../../src/components/moderation/ModerationActions';
import { ModerationApi } from '../../../src/lib/moderationApi';
import type { ModerationRow as Row } from '../../../src/lib/moderationModel';

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
  url: '/posts/Ab3-_9xQ12',
};

const inactive: Row = { ...activated, activatedAt: null };

// The actions cell lives inside a clickable row; render it in that shape so the
// stopPropagation behaviour (an action must never navigate the row) is exercised for real.
function renderInRow(row: Row, onApply: (updated: Row) => void, onRowClick: () => void = () => {}) {
  return render(
    <table>
      <tbody>
        <tr onClick={onRowClick}>
          <td>
            <ModerationActions row={row} onApply={onApply} />
          </td>
        </tr>
      </tbody>
    </table>,
  );
}

describe('ModerationActions activation control', () => {
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

  it('does not navigate the row when an action is clicked (FR-018)', () => {
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: false });
    const onRowClick = vi.fn();

    renderInRow(inactive, () => {}, onRowClick);
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));

    expect(onRowClick).not.toHaveBeenCalled();
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
  it('offers Delete for a live meme and Restore for a deleted one (exactly one)', () => {
    renderInRow(inactive, () => {});
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^restore$/i })).toBeNull();
    cleanup();

    renderInRow({ ...inactive, deletedAt: '2026-07-09 09:30:00' }, () => {});
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('requires an inline confirm before it deletes (FR-016)', async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Not sent yet — the inline confirmation must be answered first.
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('cancels a pending delete without sending it, returning to the Delete affordance', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });

    renderInRow(inactive, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('restores on a single click (no confirmation)', async () => {
    const updated = { ...inactive, deletedAt: null };
    vi.spyOn(ModerationApi, 'restore').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow({ ...inactive, deletedAt: '2026-07-09 09:30:00' }, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.restore).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('does not navigate the row when Delete then Confirm is clicked (FR-018)', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    const onRowClick = vi.fn();

    renderInRow(inactive, () => {}, onRowClick);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
