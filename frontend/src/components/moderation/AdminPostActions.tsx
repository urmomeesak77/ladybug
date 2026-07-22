import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { ActionIcon } from './ActionGlyph';
import { useNotice } from '../../hooks/useNotice';
import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult } from '../../lib/moderationApi';
import { ModerationModel } from '../../lib/moderationModel';

export type AdminPostActionsProps = {
  hash: string;
  title: string | null;
  hidden: 'pending' | 'deleted' | null;
  // The action changed the meme's public-visibility state; the caller decides what that
  // means for its surface (the feed removes it, the post page refreshes in place).
  onApplied: (hidden: 'pending' | 'deleted' | null) => void;
  // The meme was permanently removed (204); the caller drops it.
  onRemoved: () => void;
};

// Builds the state-driven menu items from the meme's coarse `hidden` state — the same
// activate/deactivate/delete/restore set the console offers (ModerationActions), keyed off
// `hidden` instead of the console row's activated_at/deleted_at. The Delete item never acts
// directly; it opens the shared confirm (soft-vs-permanent for a live meme, permanent-only
// for a soft-deleted one).
class PostActionMenu {
  static build(
    hidden: 'pending' | 'deleted' | null,
    run: (action: Promise<ModerationActionResult>) => void,
    askDelete: () => void,
    hash: string,
  ): ActionMenuItem[] {
    if (hidden === 'deleted') {
      return [
        { label: 'Restore', icon: <ActionIcon glyph="restore" />, onChoose: () => run(ModerationApi.restore(hash)) },
        { label: 'Delete', icon: <ActionIcon glyph="delete" />, danger: true, onChoose: askDelete },
      ];
    }
    const activation: ActionMenuItem = hidden === null
      ? { label: 'Deactivate', icon: <ActionIcon glyph="deactivate" />, onChoose: () => run(ModerationApi.deactivate(hash)) }
      : { label: 'Activate', icon: <ActionIcon glyph="activate" />, onChoose: () => run(ModerationApi.activate(hash)) };
    return [
      activation,
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
    ];
  }
}

// The in-place admin moderation menu shown on a feed item and the single-post page. Renders
// through the shared kebab (ActionMenu); a successful non-purge action reports the new hidden
// state upward, a purge reports removal, and any failure reports nothing (the surface is left
// untouched) — matching the console's fail-safe behaviour. This component is not self-gating
// on role; its parent renders it only for an admin+, and the server enforces access anyway.
function AdminPostActions({ hash, title, hidden, onApplied, onRemoved }: AdminPostActionsProps) {
  const { ask } = useNotice();

  function run(action: Promise<ModerationActionResult>): void {
    void action.then((result) => {
      if (result.ok) {
        onApplied(ModerationModel.hiddenFromRow(result.row));
      }
    });
  }

  function purge(): void {
    void ModerationApi.purge(hash).then((result) => {
      if (result.ok) {
        onRemoved();
      }
    });
  }

  // Delete on a live meme (public or pending) offers the soft-vs-permanent choice; on an
  // already soft-deleted meme only permanent deletion (and cancel) remains.
  function askDelete(): void {
    if (hidden === 'deleted') {
      ask({
        title: 'Delete post permanently?',
        message: ModerationModel.purgeConfirmMessage(title),
        actions: [{ caption: 'Delete permanently', onChoose: purge, strong: true }],
      });
      return;
    }
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(title),
      actions: [
        { caption: 'Soft delete', onChoose: () => run(ModerationApi.remove(hash)) },
        { caption: 'Delete permanently', onChoose: purge, strong: true },
      ],
    });
  }

  const items = PostActionMenu.build(hidden, run, askDelete, hash);
  return (
    <div className="post-actions">
      <ActionMenu items={items} label={`More actions for ${title ?? 'this post'}`} />
    </div>
  );
}

export default AdminPostActions;
