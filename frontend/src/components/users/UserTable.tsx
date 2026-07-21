import type { UserRow as Row } from '../../lib/userAdminModel';
import UserRow from './UserRow';

// The account table: a captioned, column-scoped table of every registered account. It lives
// in an overflow-x:auto container (.user-table__scroll) so the wide table can scroll on its
// own without the page ever scrolling horizontally on mobile (Principle VIII). `onApply`
// carries a row's post-action state up so the acted-on row refreshes in place (FR-016);
// `onRemove` drops a permanently deleted row in place (FR-013).
function UserTable({ rows, onApply, onRemove }: {
  rows: Row[];
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
  return (
    <div className="user-table__scroll">
      <table className="user-table">
        <caption>All accounts, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Verified</th>
            <th scope="col">Created</th>
            <th scope="col">Disabled</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <UserRow key={row.hash} row={row} onApply={onApply} onRemove={onRemove} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default UserTable;
