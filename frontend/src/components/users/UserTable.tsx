import type { UserRow as Row } from '../../lib/userAdminModel';
import UserRow from './UserRow';

// The account table: a captioned, column-scoped table of every registered account. It flows
// with the page (no dedicated scroll box) so the list has no scrollbar of its own. `onApply`
// carries a row's post-action state up so the acted-on row refreshes in place (FR-016);
// `onRemove` drops a permanently deleted row in place (FR-013).
function UserTable({ rows, onApply, onRemove }: {
  rows: Row[];
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
  return (
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
  );
}

export default UserTable;
