import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { PageMeta } from '../lib/adminPaging';
import { AdminPaging } from '../lib/adminPaging';
import { UserAdminApi } from '../lib/userAdminApi';
import type { UserRow } from '../lib/userAdminModel';
import { UserAdminModel } from '../lib/userAdminModel';

// The last settled fetch: which page it was for, its result, and whether it failed.
// `loading` is derived by comparing this page to the one the URL currently asks for, so the
// setter is only ever called from the async callback — never synchronously inside the effect.
type Loaded = { page: number; rows: UserRow[]; meta: PageMeta | null; failed: boolean };

// Fetches the named page and settles the result into state. The cleanup's `active` flag drops
// a response that resolves after the admin has paged elsewhere (or unmounted) — a slow reply
// must never paint over newer state. Its own hook keeps useUserAdmin inside the 50-line budget.
function useLoadPage(page: number, attempt: number, setLoaded: (value: Loaded) => void): void {
  useEffect(() => {
    let active = true;
    void UserAdminApi.fetchPage(page).then((result) => {
      if (!active) {
        return;
      }
      setLoaded({
        page,
        rows: result.ok ? result.data : [],
        meta: result.ok ? result.meta : null,
        failed: !result.ok,
      });
    });
    return () => {
      active = false;
    };
  }, [page, attempt, setLoaded]);
}

// Loads the account page named by the URL's ?page and re-loads whenever that page changes
// (Back/Forward/refresh restore the exact page — FR-007). A failed fetch settles into its own
// `failed` state, distinct from an empty roster: the console must never report a failure as
// "no accounts". `retry()` re-runs the same fetch; `applyRow()` swaps one row after an action.
export function useUserAdmin() {
  const [searchParams] = useSearchParams();
  const page = AdminPaging.parsePage(searchParams.get('page'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped by retry() to re-trigger the load for the same page (the page alone wouldn't
  // change, so useLoadPage's dependency list needs a second key to force a refetch).
  const [attempt, setAttempt] = useState(0);

  useLoadPage(page, attempt, setLoaded);

  // Replace one row in place after a disable/enable action (FR-016): the admin stays on the
  // current page (no refetch, so `loaded.page` is untouched) and only the acted-on row
  // changes. A no-op if the row isn't on the loaded page.
  function applyRow(updated: UserRow): void {
    setLoaded((current) => (
      current === null ? current : { ...current, rows: UserAdminModel.replaceRow(current.rows, updated) }
    ));
  }

  // Forget the failed result and bump the effect's retry key so the same page is fetched
  // again; `loading` flips true because `loaded` is null meanwhile.
  function retry(): void {
    setLoaded(null);
    setAttempt((current) => current + 1);
  }

  const loading = loaded === null || loaded.page !== page;
  const failed = !loading && loaded !== null && loaded.failed;
  const rows = loading || failed ? [] : loaded.rows;
  const meta = loading || failed ? null : loaded.meta;
  const empty = !loading && !failed && rows.length === 0;
  return { rows, meta, loading, empty, failed, retry, applyRow };
}
