import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { NoticeContext } from '../hooks/useNotice';
import type { Notice } from '../hooks/useNotice';
import NoticeDialog from './NoticeDialog';

// App-level host for the NoticeDialog. Pages raise notices through useNotice(); rendering
// the dialog here lets it survive route changes — a register success redirects away from
// /register (RequireAnon) the moment auth state flips, which would unmount a page-local
// dialog before the user saw it.
function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  const show = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
  }, []);

  const value = useMemo(() => ({ notice, show, clear }), [notice, show, clear]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notice ? <NoticeDialog message={notice.message} title={notice.title} onClose={clear} /> : null}
    </NoticeContext.Provider>
  );
}

export default NoticeProvider;
