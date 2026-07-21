import type { ReactElement } from 'react';

import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { useNotice } from '../../hooks/useNotice';
import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult } from '../../lib/moderationApi';
import { ModerationModel } from '../../lib/moderationModel';
import type { ModerationRow as Row } from '../../lib/moderationModel';

type Apply = (updated: Row) => void;

type Remove = (hash: string) => void;

// Runs a moderation action's promise and refreshes the row on success (bound to onApply).
type ApplyAction = (action: Promise<ModerationActionResult>) => void;

type ActionGlyph = 'activate' | 'deactivate' | 'delete' | 'restore';

// Flat single-path glyphs (24x24, filled with currentColor) drawn in the same spirit as the
// LeftMenu icon set: a play triangle, pause bars, a trash can, and an undo arc.
const GLYPHS: Record<ActionGlyph, string> = {
  activate: 'M8 5v14l11-7z',
  deactivate: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-4.9-2L6.7 18.4A9 9 0 1 0 13 3z',
};

// Decorative only: the menu item's text label carries the accessible meaning (Principle IV /
// FR-002); the icon accompanies it (FR-015).
function ActionIcon({ glyph }: { glyph: ActionGlyph }): ReactElement {
  return (
    <svg className="moderation-actions__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

// Await a moderation action and, on success, push the updated row upward; a failed action
// (non-2xx or network) leaves the row untouched — the table simply doesn't change. A class
// (not a loose function) per docs/CODING_CONVENTIONS.md; the IO itself stays in ModerationApi.
class RowAction {
  static async apply(action: Promise<ModerationActionResult>, onApply: Apply): Promise<void> {
    const result = await action;
    if (result.ok) {
      onApply(result.row);
    }
  }
}

// The purge sibling of RowAction: a 204 means the row no longer exists, so success reports the
// hash upward for removal instead of an updated row.
class RowPurge {
  static async apply(hash: string, onRemove: Remove): Promise<void> {
    const result = await ModerationApi.purge(hash);
    if (result.ok) {
      onRemove(hash);
    }
  }
}

// Builds the state-dependent menu item list. A live meme offers Activate/Deactivate and a
// single Delete; a soft-deleted meme offers Restore and Delete (FR-016). Each item carries an
// icon and a text label (FR-015). The soft-vs-permanent choice is not in the menu — Delete
// opens the existing confirm: a live meme's Delete opens the soft-vs-permanent popup (FR-017),
// a soft-deleted meme's Delete opens the permanent-only popup.
class ModerationMenu {
  static live(row: Row, apply: ApplyAction, askDelete: () => void): ActionMenuItem[] {
    const activated = row.activatedAt !== null;
    const activation: ActionMenuItem = activated
      ? {
          label: 'Deactivate',
          icon: <ActionIcon glyph="deactivate" />,
          onChoose: () => apply(ModerationApi.deactivate(row.hash)),
        }
      : {
          label: 'Activate',
          icon: <ActionIcon glyph="activate" />,
          onChoose: () => apply(ModerationApi.activate(row.hash)),
        };
    return [
      activation,
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
    ];
  }

  static deleted(row: Row, apply: ApplyAction, askPurge: () => void): ActionMenuItem[] {
    return [
      {
        label: 'Restore',
        icon: <ActionIcon glyph="restore" />,
        onChoose: () => apply(ModerationApi.restore(row.hash)),
      },
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askPurge },
    ];
  }
}

// The per-row moderation controls, now gathered behind the shared kebab menu (US2). Navigation
// still lives solely on the title link (FR-018); the menu is transient and never changes the
// URL (FR-019). Every action, confirmation, and row-refresh / row-removal outcome is reused
// from the pre-menu control unchanged — this is presentation only (research D9).
function ModerationActions({ row, onApply, onRemove }: { row: Row; onApply: Apply; onRemove: Remove }) {
  const { ask } = useNotice();

  function apply(action: Promise<ModerationActionResult>): void {
    void RowAction.apply(action, onApply);
  }

  function purge(): void {
    void RowPurge.apply(row.hash, onRemove);
  }

  // A live meme: both delete items open this soft-vs-permanent choice (FR-017).
  function askDelete(): void {
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(row.title),
      actions: [
        { caption: 'Soft delete', onChoose: () => apply(ModerationApi.remove(row.hash)) },
        { caption: 'Delete permanently', onChoose: purge, strong: true },
      ],
    });
  }

  // A soft-deleted meme: permanent-only confirm (soft delete is moot).
  function askPurge(): void {
    ask({
      title: 'Delete post permanently?',
      message: ModerationModel.purgeConfirmMessage(row.title),
      actions: [{ caption: 'Delete permanently', onChoose: purge, strong: true }],
    });
  }

  const items = row.deletedAt !== null
    ? ModerationMenu.deleted(row, apply, askPurge)
    : ModerationMenu.live(row, apply, askDelete);

  return (
    <div className="moderation-actions">
      <ActionMenu items={items} label={`More actions for ${row.title ?? 'this post'}`} />
    </div>
  );
}

export default ModerationActions;
