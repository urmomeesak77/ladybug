// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminPostActions from '../../../src/components/moderation/AdminPostActions';
import NoticeProvider from '../../../src/components/NoticeProvider';
import { ModerationApi } from '../../../src/lib/moderationApi';
import type { ModerationRow } from '../../../src/lib/moderationModel';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function row(overrides: Partial<ModerationRow> = {}): ModerationRow {
  return {
    hash: 'Ab3-_9xQ12',
    thumbnail: null,
    title: null,
    type: null,
    username: null,
    createdAt: null,
    activatedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function renderActions(
  hidden: 'pending' | 'deleted' | null,
  onApplied = vi.fn(),
  onRemoved = vi.fn(),
) {
  render(
    <NoticeProvider>
      <AdminPostActions
        hash="Ab3-_9xQ12"
        title="A funny post"
        hidden={hidden}
        onApplied={onApplied}
        onRemoved={onRemoved}
      />
    </NoticeProvider>,
  );
  return { onApplied, onRemoved };
}

function openMenu() {
  fireEvent.click(screen.getByRole('button'));
}

describe('AdminPostActions menu shape', () => {
  it('offers Deactivate + Delete for a public post', () => {
    renderActions(null);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
  });

  it('offers Activate + Delete for a pending post', () => {
    renderActions('pending');
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^activate$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
  });

  it('offers Restore + Delete for a deleted post', () => {
    renderActions('deleted');
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
  });

  it('shows each menu item as an icon together with a text label', () => {
    renderActions('pending');
    openMenu();
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(item.textContent?.trim()).not.toBe('');
    }
  });
});

describe('AdminPostActions behaviour', () => {
  it('deactivates and reports the derived hidden state', async () => {
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({ ok: true, row: row({ activatedAt: null }) });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('pending'));
    expect(ModerationApi.deactivate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('activates a pending post and reports null (public)', async () => {
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({ ok: true, row: row({ activatedAt: '2026-07-09 08:00:00' }) });
    const { onApplied } = renderActions('pending');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^activate$/i }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(null));
  });

  it('restores a soft-deleted post on a single click and reports the new state', async () => {
    vi.spyOn(ModerationApi, 'restore').mockResolvedValue({ ok: true, row: row({ activatedAt: '2026-07-09 08:00:00', deletedAt: null }) });
    const { onApplied } = renderActions('deleted');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^restore$/i }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(null));
    expect(ModerationApi.restore).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('soft-deletes via the confirm and reports deleted', async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: row({ activatedAt: '2026-07-09 08:00:00', deletedAt: '2026-07-09 09:00:00' }) });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Soft delete' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('deleted'));
  });

  it('purges via the permanent choice and reports removal', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const { onRemoved } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('gives a soft-deleted post the permanent-only confirm and purges', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const { onRemoved } = renderActions('deleted');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    expect(screen.getByRole('heading', { name: 'Delete post permanently?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(within(dialog).queryByRole('button', { name: 'Soft delete' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('reports nothing when an action fails', async () => {
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({ ok: false });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
    await Promise.resolve();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('reports nothing when a purge fails', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const { onRemoved } = renderActions('deleted');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await Promise.resolve();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('names the post in the trigger label', () => {
    renderActions(null);
    expect(screen.getByRole('button', { name: 'More actions for A funny post' })).toBeTruthy();
  });

  it('falls back to "this post" copy when the post has no title', () => {
    render(
      <NoticeProvider>
        <AdminPostActions hash="Ab3-_9xQ12" title={null} hidden={null} onApplied={vi.fn()} onRemoved={vi.fn()} />
      </NoticeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions for this post' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    expect(
      screen.getByText(
        'Soft delete hides this post from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();
  });
});
