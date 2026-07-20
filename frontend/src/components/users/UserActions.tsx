import { useState } from 'react';

import { UserAdminApi } from '../../lib/userAdminApi';
import type { UserRow as Row } from '../../lib/userAdminModel';

// The single per-row access control: Disable for an active account, Enable for a disabled one.
// One click, no confirmation step — disabling is reversible (unlike a meme purge), so it needs
// no modal (FR-016). The button is disabled while its request is in flight so a double-click
// cannot fire two transitions. On success the server's updated row is pushed up via `onApply`
// for an in-place refresh; a failed action leaves the row exactly as it was (never paints
// unconfirmed state). The US4 rank guard, which hides this control on peers/higher ranks and
// the viewer's own row, wraps it in a later slice.
function UserActions({ row, onApply }: { row: Row; onApply: (updated: Row) => void }) {
  const [pending, setPending] = useState(false);
  const label = row.isDisabled ? 'Enable' : 'Disable';

  async function act(): Promise<void> {
    setPending(true);
    const result = row.isDisabled ? await UserAdminApi.enable(row.hash) : await UserAdminApi.disable(row.hash);
    setPending(false);
    if (result.ok) {
      onApply(result.row);
    }
  }

  return (
    <button
      type="button"
      className="user-actions__button"
      onClick={() => void act()}
      disabled={pending}
      aria-label={label}
      title={label}
    >
      {label}
    </button>
  );
}

export default UserActions;
