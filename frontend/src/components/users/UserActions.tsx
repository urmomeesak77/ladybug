import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { useAuth } from '../../hooks/useAuth';
import { useNotice } from '../../hooks/useNotice';
import { Role } from '../../lib/role';
import type { RoleName } from '../../lib/role';
import { UserAdminApi } from '../../lib/userAdminApi';
import { UserAdminModel } from '../../lib/userAdminModel';
import type { UserRow as Row } from '../../lib/userAdminModel';

// The per-row account actions, gathered behind the shared kebab menu (US1): Enable/Disable
// (per state, one click, no confirm — reversible, FR-014) plus the new Delete permanently
// (destructive emphasis, always a text label, guarded by a naming confirm — FR-002/FR-008).
//
// Strict-rank guard (research D6): an actor may act only on accounts ranked strictly below
// their own. Because outranks is strict, peers, higher ranks and the viewer's own row have an
// empty item list, so the menu renders nothing and a short textual reason takes its place
// (FR-006). The server re-checks every request, so no `can_*` field is added to the payload.
function UserActions({ row, onApply, onRemove }: {
  row: Row;
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
  const { role } = useAuth();
  const { ask } = useNotice();

  async function toggle(): Promise<void> {
    const result = row.isDisabled ? await UserAdminApi.enable(row.hash) : await UserAdminApi.disable(row.hash);
    if (result.ok) {
      onApply(result.row);
    }
  }

  async function confirmDelete(): Promise<void> {
    const result = await UserAdminApi.destroy(row.hash);
    if (result.ok) {
      onRemove(row.hash);
    }
  }

  function askDelete(): void {
    ask({
      title: 'Delete account permanently?',
      message: UserAdminModel.deleteConfirmMessage(row.name),
      actions: [{ caption: 'Delete permanently', onChoose: () => void confirmDelete(), strong: true }],
    });
  }

  if (!Role.outranks(role, row.role as RoleName)) {
    return <span className="user-actions__none">No permission</span>;
  }

  const items: ActionMenuItem[] = [
    { label: row.isDisabled ? 'Enable' : 'Disable', onChoose: () => void toggle() },
    { label: 'Delete permanently', danger: true, onChoose: askDelete },
  ];

  return <ActionMenu items={items} label={`More actions for ${row.name}`} />;
}

export default UserActions;
