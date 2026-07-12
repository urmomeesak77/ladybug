import type { MouseEvent, ReactElement } from 'react';

import { useNotice } from '../../hooks/useNotice';
import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult, ModerationPurgeResult } from '../../lib/moderationApi';
import { ModerationModel } from '../../lib/moderationModel';
import type { ModerationRow as Row } from '../../lib/moderationModel';

type Apply = (updated: Row) => void;

type Remove = (hash: string) => void;

type ActionGlyph = 'activate' | 'deactivate' | 'delete' | 'restore';

// Flat single-path glyphs (24x24, filled with currentColor) drawn in the same spirit as the
// LeftMenu icon set: a play triangle, pause bars, a trash can, and an undo arc.
const GLYPHS: Record<ActionGlyph, string> = {
  activate: 'M8 5v14l11-7z',
  deactivate: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-4.9-2L6.7 18.4A9 9 0 1 0 13 3z',
};

// Decorative only: the button's aria-label/title carries the accessible name (Principle IV).
function ActionIcon({ glyph }: { glyph: ActionGlyph }): ReactElement {
  return (
    <svg className="moderation-actions__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

// The per-row moderation controls (US3 activation + US4 delete/restore). Navigation lives
// solely on the title link (FR-018), so these buttons are ordinary siblings that never
// navigate; a successful state change hands the server's updated row back up via `onApply`
// for an in-place refresh (FR-017), while a successful purge reports the hash via `onRemove`
// so the page drops the now-nonexistent row.
function ModerationActions({ row, onApply, onRemove }: { row: Row; onApply: Apply; onRemove: Remove }) {
  return (
    <div className="moderation-actions">
      <ActivationButton row={row} onApply={onApply} />
      <DeletionControl row={row} onApply={onApply} onRemove={onRemove} />
    </div>
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

// The purge sibling of RowAction: a 204 means the row no longer exists, so success reports
// the hash upward for removal instead of an updated row.
class RowPurge {
  static async apply(action: Promise<ModerationPurgeResult>, hash: string, onRemove: Remove): Promise<void> {
    const result = await action;
    if (result.ok) {
      onRemove(hash);
    }
  }
}

// Exactly one activation control, reflecting the row's current state. A meme is activated
// precisely when it carries an activated_at timestamp.
function ActivationButton({ row, onApply }: { row: Row; onApply: Apply }) {
  const activated = row.activatedAt !== null;

  function toggle(): void {
    void RowAction.apply(activated ? ModerationApi.deactivate(row.hash) : ModerationApi.activate(row.hash), onApply);
  }

  const label = activated ? 'Deactivate' : 'Activate';

  return (
    <button type="button" className="moderation-actions__button" onClick={toggle} aria-label={label} title={label}>
      <ActionIcon glyph={activated ? 'deactivate' : 'activate'} />
    </button>
  );
}

// The two controls a soft-deleted meme offers: single-click restore, and a trash
// button whose confirm offers only permanent deletion (soft delete is moot).
function DeletedRowControls({ onRestore, onAskPurge }: {
  onRestore: (event: MouseEvent<HTMLButtonElement>) => void;
  onAskPurge: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="moderation-actions__button"
        onClick={onRestore}
        aria-label="Restore"
        title="Restore"
      >
        <ActionIcon glyph="restore" />
      </button>
      <button
        type="button"
        className="moderation-actions__button"
        onClick={onAskPurge}
        aria-label="Delete permanently"
        title="Delete permanently"
      >
        <ActionIcon glyph="delete" />
      </button>
    </>
  );
}

// Deletion, guarded by a blocking modal confirm raised app-level via useNotice (FR-016).
// A live meme's trash button offers soft delete and permanent delete; a soft-deleted meme
// shows single-click Restore plus a trash button offering only permanent delete.
function DeletionControl({ row, onApply, onRemove }: { row: Row; onApply: Apply; onRemove: Remove }) {
  const { ask } = useNotice();
  const deleted = row.deletedAt !== null;

  function restore(): void {
    void RowAction.apply(ModerationApi.restore(row.hash), onApply);
  }

  function confirmSoftDelete(): void {
    void RowAction.apply(ModerationApi.remove(row.hash), onApply);
  }

  function confirmPurge(): void {
    void RowPurge.apply(ModerationApi.purge(row.hash), row.hash, onRemove);
  }

  function askDelete(): void {
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(row.title),
      actions: [
        { caption: 'Soft delete', onChoose: confirmSoftDelete },
        { caption: 'Delete permanently', onChoose: confirmPurge, strong: true },
      ],
    });
  }

  function askPurge(): void {
    ask({
      title: 'Delete post permanently?',
      message: ModerationModel.purgeConfirmMessage(row.title),
      actions: [{ caption: 'Delete permanently', onChoose: confirmPurge, strong: true }],
    });
  }

  if (deleted) {
    return <DeletedRowControls onRestore={restore} onAskPurge={askPurge} />;
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete} aria-label="Delete" title="Delete">
      <ActionIcon glyph="delete" />
    </button>
  );
}

export default ModerationActions;
