import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ModerationRow as Row } from '../../lib/moderationModel';
import { ModerationModel } from '../../lib/moderationModel';
import ModerationThumbnail from './ModerationThumbnail';

// Shown in the user column when a meme has no resolvable uploader name at all.
const NO_UPLOADER = '—';

// A state cell: an aria-hidden glyph plus the text label, so state reads without relying
// on color (FR-014). The text is the accessible signal; the glyph is decoration.
function StateBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`moderation-state ${on ? 'moderation-state--on' : 'moderation-state--off'}`}>
      <span aria-hidden="true">{on ? '●' : '○'}</span> {label}
    </span>
  );
}

// One moderation-table row. The whole row is a link to the meme's own page (FR-018) —
// keyboard-operable via role="link" + Enter/Space — while the trailing actions cell (its
// controls added in US3/US4) stops propagation so acting never navigates.
function ModerationRow({ row }: { row: Row }) {
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
      <td><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time></td>
      <td><StateBadge on={row.activated} label={ModerationModel.activationLabel(row.activated)} /></td>
      <td><StateBadge on={row.deleted} label={ModerationModel.deletionLabel(row.deleted)} /></td>
      <td className="moderation-row__actions" />
    </tr>
  );
}

export default ModerationRow;
