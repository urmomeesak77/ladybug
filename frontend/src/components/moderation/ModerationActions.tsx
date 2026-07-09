import type { MouseEvent } from 'react';

import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationRow as Row } from '../../lib/moderationModel';

// The per-row moderation controls (US3: activation; Delete/Restore land in US4). Exactly one
// activation control shows, reflecting the row's current state. Every action stops the click
// from bubbling to the row so acting never navigates to the meme page (FR-018); a successful
// action hands the server's updated row back up via `onApply` for an in-place refresh.
function ModerationActions({ row, onApply }: { row: Row; onApply: (updated: Row) => void }) {
  async function toggleActivation(): Promise<void> {
    const result = row.activated
      ? await ModerationApi.deactivate(row.hash)
      : await ModerationApi.activate(row.hash);
    if (result.ok) {
      onApply(result.row);
    }
  }

  function handleActivation(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void toggleActivation();
  }

  return (
    <div className="moderation-actions">
      <button type="button" className="moderation-actions__button" onClick={handleActivation}>
        {row.activated ? 'Deactivate' : 'Activate'}
      </button>
    </div>
  );
}

export default ModerationActions;
