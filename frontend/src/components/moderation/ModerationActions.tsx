import { useState } from 'react';
import type { MouseEvent } from 'react';

import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult } from '../../lib/moderationApi';
import type { ModerationRow as Row } from '../../lib/moderationModel';

type Apply = (updated: Row) => void;

// The per-row moderation controls (US3 activation + US4 delete/restore). Every button stops
// the click from bubbling to the row so acting never navigates to the meme page (FR-018); a
// successful action hands the server's updated row back up via `onApply` for an in-place
// refresh, keeping the admin on the current page (FR-017).
function ModerationActions({ row, onApply }: { row: Row; onApply: Apply }) {
  return (
    <div className="moderation-actions">
      <ActivationButton row={row} onApply={onApply} />
      <DeletionControl row={row} onApply={onApply} />
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

// Exactly one activation control, reflecting the row's current state. A meme is activated
// precisely when it carries an activated_at timestamp.
function ActivationButton({ row, onApply }: { row: Row; onApply: Apply }) {
  const activated = row.activatedAt !== null;

  function toggle(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void RowAction.apply(activated ? ModerationApi.deactivate(row.hash) : ModerationApi.activate(row.hash), onApply);
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={toggle}>
      {activated ? 'Deactivate' : 'Activate'}
    </button>
  );
}

// Delete (guarded by a lightweight inline confirm, FR-016) for a live meme; single-click
// Restore for a soft-deleted one. Exactly one path shows, per the row's deleted state.
function DeletionControl({ row, onApply }: { row: Row; onApply: Apply }) {
  const [confirming, setConfirming] = useState(false);
  const deleted = row.deletedAt !== null;

  function restore(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void RowAction.apply(ModerationApi.restore(row.hash), onApply);
  }

  function askDelete(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    setConfirming(true);
  }

  function cancelDelete(): void {
    setConfirming(false);
  }

  function confirmDelete(): void {
    setConfirming(false);
    void RowAction.apply(ModerationApi.remove(row.hash), onApply);
  }

  if (deleted) {
    return (
      <button type="button" className="moderation-actions__button" onClick={restore}>
        Restore
      </button>
    );
  }

  if (confirming) {
    return <DeleteConfirm onConfirm={confirmDelete} onCancel={cancelDelete} />;
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete}>
      Delete
    </button>
  );
}

// The inline two-step confirmation for a delete (FR-016). Both buttons stop propagation so
// answering the prompt never navigates the row; `onConfirm`/`onCancel` carry the decision up.
function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  function confirm(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onConfirm();
  }

  function cancel(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onCancel();
  }

  return (
    <>
      <button type="button" className="moderation-actions__button moderation-actions__button--danger" onClick={confirm}>
        Confirm delete
      </button>
      <button type="button" className="moderation-actions__button" onClick={cancel}>
        Cancel
      </button>
    </>
  );
}

export default ModerationActions;
