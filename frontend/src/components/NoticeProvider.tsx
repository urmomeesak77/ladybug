import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { NoticeContext } from '../hooks/useNotice';
import type { Confirm, Notice } from '../hooks/useNotice';
import ConfirmDialog from './ConfirmDialog';
import NoticeDialog from './NoticeDialog';

// App-level host for the NoticeDialog and ConfirmDialog. Pages raise notices through
// useNotice(); rendering the dialogs here lets them survive route changes — a register
// success redirects away from /register (RequireAnon) the moment auth state flips, which
// would unmount a page-local dialog before the user saw it. Notice and confirm are never
// raised together in practice; if they ever are, the confirm wins the screen and clear()
// closes both.
function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const show = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const ask = useCallback((next: Confirm) => {
    setConfirm(next);
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
    setConfirm(null);
  }, []);

  // Confirming closes the dialog first, then runs the caller's action exactly once.
  const runConfirm = useCallback(() => {
    setConfirm(null);
    confirm?.onConfirm();
  }, [confirm]);

  const value = useMemo(() => ({ notice, confirm, show, ask, clear }), [notice, confirm, show, ask, clear]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notice && !confirm ? <NoticeDialog message={notice.message} title={notice.title} onClose={clear} /> : null}
      {confirm ? (
        <ConfirmDialog
          message={confirm.message}
          title={confirm.title}
          confirmCaption={confirm.confirmCaption}
          onConfirm={runConfirm}
          onCancel={clear}
        />
      ) : null}
    </NoticeContext.Provider>
  );
}

export default NoticeProvider;
