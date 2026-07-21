import { useEffect } from 'react';

import AdminPagination from '../components/admin/AdminPagination';
import ErrorState from '../components/states/ErrorState';
import UserTable from '../components/users/UserTable';
import { useUserAdmin } from '../hooks/useUserAdmin';

// The /admin/users account console (US1): the full-roster table plus its numbered page links,
// with a loading indicator while a page is in flight, an explicit empty state for an empty
// roster or an out-of-range page (FR-017), and a distinct error+retry state for a failed
// fetch — the console must never report a failure as "no accounts". The route is gated to
// admin+ in US2; here the page trusts the server, which already refuses non-admin callers.
function UserAdminPage() {
  const { rows, meta, loading, empty, failed, retry, applyRow } = useUserAdmin();

  useEffect(() => {
    document.title = 'Users';
  }, []);

  return (
    <section className="user-admin" aria-label="Users">
      <h1>Users</h1>
      {loading && <p className="user-admin__status">Loading accounts…</p>}
      {failed && <ErrorState onRetry={retry} />}
      {empty && <p className="user-admin__status">No accounts to show.</p>}
      {!loading && !empty && !failed && (
        <>
          <UserTable rows={rows} onApply={applyRow} />
          {meta !== null && <AdminPagination meta={meta} label="Account pages" />}
        </>
      )}
    </section>
  );
}

export default UserAdminPage;
