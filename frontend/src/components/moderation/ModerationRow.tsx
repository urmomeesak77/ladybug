import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ModerationRow as Row } from '../../lib/moderationModel';
import ModerationActions from './ModerationActions';
import ModerationThumbnail from './ModerationThumbnail';

// Shown in the user column when a meme has no resolvable uploader name at all.
const NO_UPLOADER = '—';

// A timestamp cell: the raw MySQL datetime as the server sent it, or an empty cell when the
// meme was never activated / isn't deleted. Text (or its absence) carries the meaning — never
// color alone (FR-014); the column header names what an empty cell means.
function TimeCell({ value }: { value: string | null }) {
  return <td className="moderation-time">{value ?? ''}</td>;
}

// One moderation-table row. The whole row is a link to the meme's own page (FR-018) —
// keyboard-operable via role="link" + Enter/Space — while the trailing actions cell stops
// propagation so acting never navigates. `onApply` refreshes this row in place after an action.
function ModerationRow({ row, onApply }: { row: Row; onApply: (updated: Row) => void }) {
  const navigate = useNavigate();

  function open(): void {
    navigate(row.url);
  }

  function handleKey(event: KeyboardEvent<HTMLTableRowElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }

  const uploader = row.username ?? NO_UPLOADER;
  const alt = row.username !== null ? `Meme by ${row.username}` : 'Meme thumbnail';

  return (
    <tr
      className="moderation-row"
      onClick={open}
      onKeyDown={handleKey}
      tabIndex={0}
      role="link"
      aria-label={`Open meme ${row.hash}`}
    >
      <td><ModerationThumbnail src={row.thumbnail} alt={alt} /></td>
      <td>{uploader}</td>
      <TimeCell value={row.createdAt} />
      <TimeCell value={row.activatedAt} />
      <TimeCell value={row.deletedAt} />
      <td className="moderation-row__actions">
        <ModerationActions row={row} onApply={onApply} />
      </td>
    </tr>
  );
}

export default ModerationRow;
