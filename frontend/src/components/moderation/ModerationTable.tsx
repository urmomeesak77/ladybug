import type { ModerationRow as Row } from '../../lib/moderationModel';
import ModerationRow from './ModerationRow';

// The moderation table: a captioned, column-scoped table of moderation rows. It lives in an
// overflow-x:auto container (.moderation-table__scroll) so the wide table can scroll on its
// own without the page ever scrolling horizontally on mobile (Principle VIII). `onApply`
// carries a row's post-action state up so the acted-on row refreshes in place.
function ModerationTable({ rows, onApply }: { rows: Row[]; onApply: (updated: Row) => void }) {
  return (
    <div className="moderation-table__scroll">
      <table className="moderation-table">
        <caption>All memes, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Thumbnail</th>
            <th scope="col">User</th>
            <th scope="col">Created</th>
            <th scope="col">Activated</th>
            <th scope="col">Deleted</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ModerationRow key={row.hash} row={row} onApply={onApply} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ModerationTable;
