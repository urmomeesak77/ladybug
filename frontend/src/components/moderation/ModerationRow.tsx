import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ModerationModel } from '../../lib/moderationModel';
import type { ModerationRow as Row } from '../../lib/moderationModel';
import ModerationActions from './ModerationActions';
import ModerationThumbnail from './ModerationThumbnail';

// Shown in the user column when a meme has no resolvable uploader name at all.
const NO_UPLOADER = '—';

// A timestamp cell: only the date part is shown (keeps the table narrow); hovering reveals
// the full raw MySQL datetime via the native tooltip. An empty cell means the meme was never
// activated / isn't deleted — text (or its absence) carries the meaning, never color alone
// (FR-014); the column header names what an empty cell means.
function TimeCell({ value }: { value: string | null }) {
  if (value === null) {
    return <td className="moderation-time" />;
  }
  return (
    <td className="moderation-time" title={value}>
      {ModerationModel.dateOnly(value)}
    </td>
  );
}

// The title cell: at most 20 characters on screen; a cut title carries the full text in a
// hover tooltip so nothing is lost.
function TitleCell({ title }: { title: string | null }) {
  const short = ModerationModel.shortTitle(title);
  if (short === title) {
    return <td className="moderation-title">{title ?? ''}</td>;
  }
  return (
    <td className="moderation-title" title={title ?? undefined}>
      {short}
    </td>
  );
}

// One moderation-table row. The whole row is a link to the meme's own page (FR-018) —
// keyboard-operable via role="link" + Enter/Space — while the trailing actions cell stops
// propagation so acting never navigates. `onApply` refreshes this row in place after an
// action; `onRemove` drops it after a purge.
function ModerationRow({ row, onApply, onRemove }: {
  row: Row;
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
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
      <TitleCell title={row.title} />
      <td>{uploader}</td>
      <TimeCell value={row.createdAt} />
      <TimeCell value={row.activatedAt} />
      <TimeCell value={row.deletedAt} />
      <td className="moderation-row__actions">
        <ModerationActions row={row} onApply={onApply} onRemove={onRemove} />
      </td>
    </tr>
  );
}

export default ModerationRow;
