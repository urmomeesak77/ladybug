import type { UserRow as Row } from '../../lib/userAdminModel';
import { UserAdminModel } from '../../lib/userAdminModel';

// The Created cell: only the date part is shown (keeps the table narrow); hovering reveals
// the full raw MySQL datetime via the native tooltip.
function CreatedCell({ value }: { value: string | null }) {
  if (value === null) {
    return <td className="user-time" />;
  }
  return (
    <td className="user-time" title={value}>
      {UserAdminModel.dateOnly(value)}
    </td>
  );
}

// The Disabled cell: empty for an active account (the column header names what that means),
// otherwise the disabled date and the acting account's name — or the date alone when the
// actor is unresolvable (INV-3). The full timestamp stays available as the cell tooltip.
// Text carries the state, never colour alone (FR-005).
function DisabledCell({ row }: { row: Row }) {
  const summary = UserAdminModel.disabledSummary(row);
  if (summary === null) {
    return <td className="user-disabled user-time" />;
  }
  return (
    <td className="user-disabled user-time" title={row.disabledAt ?? undefined}>
      {summary}
    </td>
  );
}

// One account-table row. The seventh cell holds the per-row Disable/Enable control, added in
// US3; in US1 it is an empty placeholder so the column count matches the header.
function UserRow({ row }: { row: Row }) {
  return (
    <tr className="user-row">
      <td className="user-name">{row.name}</td>
      <td className="user-email">{row.email}</td>
      <td className="user-role">{row.role}</td>
      <td className="user-verified">{UserAdminModel.verifiedLabel(row.emailVerifiedAt)}</td>
      <CreatedCell value={row.createdAt} />
      <DisabledCell row={row} />
      <td className="user-row__actions" />
    </tr>
  );
}

export default UserRow;
