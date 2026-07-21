import { Link } from 'react-router-dom';

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

// The title cell doubles as the row's navigation: a real <Link> (FR-018), so screen
// readers get one honest link per row instead of buttons nested inside a row-wide
// role="link" (invalid ARIA nesting — review 2026-07-10). The permalink is built
// client-side from the hash, like every other permalink in the SPA; untitled posts
// fall back to the hash so the link always has text.
function TitleCell({ row }: { row: Row }) {
  const short = ModerationModel.shortTitle(row.title);
  return (
    <td className="moderation-title" title={row.title ?? undefined}>
      <Link className="moderation-title__link" to={`/posts/${row.hash}`}>
        {short ?? row.hash}
      </Link>
    </td>
  );
}

// One moderation-table row. Navigation lives on the title link; the actions cell's
// buttons are ordinary siblings, so acting never navigates. `onApply` refreshes this
// row in place after an action; `onRemove` drops it after a purge.
function ModerationRow({ row, onApply, onRemove }: {
  row: Row;
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
  const uploader = row.username ?? NO_UPLOADER;
  const alt = row.username !== null ? `Meme by ${row.username}` : 'Meme thumbnail';

  return (
    <tr className="moderation-row">
      <td><ModerationThumbnail src={row.thumbnail} alt={alt} /></td>
      <TitleCell row={row} />
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
