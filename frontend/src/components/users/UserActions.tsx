import type { ReactElement } from 'react';

import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { useAuth } from '../../hooks/useAuth';
import { useNotice } from '../../hooks/useNotice';
import { Role } from '../../lib/role';
import type { RoleName } from '../../lib/role';
import { UserAdminApi } from '../../lib/userAdminApi';
import { UserAdminModel } from '../../lib/userAdminModel';
import type { UserRow as Row } from '../../lib/userAdminModel';

type ActionGlyph = 'enable' | 'disable' | 'delete';

// Flat single-path glyphs (24x24, filled with currentColor), same spirit as the moderation
// menu's icon set: a check-circle for Enable, a no-entry circle for Disable, a trash can for
// Delete permanently.
const GLYPHS: Record<ActionGlyph, string> = {
  enable: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  disable: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
};

// Decorative only: the menu item's text label carries the accessible meaning (Principle IV /
// FR-002); the icon merely accompanies it (FR-015).
function ActionIcon({ glyph }: { glyph: ActionGlyph }): ReactElement {
  return (
    <svg className="action-menu__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

// The per-row account actions, gathered behind the shared kebab menu (US1): Enable/Disable
// (per state, one click, no confirm — reversible, FR-014) plus the new Delete permanently
// (destructive emphasis, always a text label, guarded by a naming confirm — FR-002/FR-008).
// Each item carries a decorative icon alongside its text label (FR-015).
//
// Strict-rank guard (research D6): an actor may act only on accounts ranked strictly below
// their own. Because outranks is strict, peers, higher ranks and the viewer's own row have no
// permitted action, so the control renders nothing at all (FR-006). The server re-checks every
// request, so no `can_*` field is added to the payload.
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
    return null;
  }

  const items: ActionMenuItem[] = [
    row.isDisabled
      ? { label: 'Enable', icon: <ActionIcon glyph="enable" />, onChoose: () => void toggle() }
      : { label: 'Disable', icon: <ActionIcon glyph="disable" />, onChoose: () => void toggle() },
    { label: 'Delete permanently', danger: true, icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
  ];

  return <ActionMenu items={items} label={`More actions for ${row.name}`} />;
}

export default UserActions;
