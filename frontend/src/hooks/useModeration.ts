import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ModerationApi } from '../lib/moderationApi';
import type { ModerationMeta, ModerationRow } from '../lib/moderationModel';
import { ModerationModel } from '../lib/moderationModel';

// The last settled fetch: which page it was for, its result, and whether it failed.
// `loading` is derived by comparing this page to the one the URL currently asks for, so
// the setter is only ever called from the async callback — never synchronously inside the
// effect.
type Loaded = { page: number; rows: ModerationRow[]; meta: ModerationMeta | null; failed: boolean };

// Fetches the named page and settles the result into state. The cleanup's `active`
// flag drops a response that resolves after the admin has paged elsewhere (or
// unmounted) — a slow reply must never paint over newer state. Its own hook keeps
// useModeration inside the 50-line budget (Principle II).
function useLoadPage(page: number, attempt: number, setLoaded: (value: Loaded) => void): void {
  useEffect(() => {
    let active = true;
    void ModerationApi.fetchPage(page).then((result) => {
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

// Loads the moderation page named by the URL's ?page and re-loads whenever that page
// changes (Back/Forward/refresh restore the exact page — FR-004/FR-005). A failed fetch
// settles into its own `failed` state, distinct from the empty corpus: a destructive admin
// tool must never report a failure as "no entries." `retry()` re-runs the same fetch.
export function useModeration() {
  const [searchParams] = useSearchParams();
  const page = ModerationModel.parsePage(searchParams.get('page'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped by retry() to re-trigger the load for the same page (the page alone wouldn't
  // change, so useLoadPage's dependency list needs a second key to force a refetch).
  const [attempt, setAttempt] = useState(0);

  useLoadPage(page, attempt, setLoaded);

  // Replace one row in place after a moderation action (FR-017): the admin stays on the
  // current page (no refetch, so `loaded.page` is untouched) and only the acted-on row's
  // state changes. A no-op if the row isn't on the loaded page.
  function applyRow(updated: ModerationRow): void {
    setLoaded((current) => (
      current === null ? current : { ...current, rows: ModerationModel.replaceRow(current.rows, updated) }
    ));
  }

  // Drop a purged row from the page (the server returned 204 — the row no longer exists).
  // No refetch: the admin stays on the current page; the meta counts stay as fetched until
  // the next page load (acceptable staleness for a back-office table).
  function removeRow(hash: string): void {
    setLoaded((current) => (
      current === null ? current : { ...current, rows: ModerationModel.dropRow(current.rows, hash) }
    ));
  }

  // Forget the failed result and bump the effect's retry key so the same page is
  // fetched again; `loading` flips true because `loaded` is null meanwhile.
  function retry(): void {
    setLoaded(null);
    setAttempt(attempt + 1);
  }

  const loading = loaded === null || loaded.page !== page;
  const failed = !loading && loaded !== null && loaded.failed;
  const rows = loading || failed ? [] : loaded.rows;
  const meta = loading || failed ? null : loaded.meta;
  const empty = !loading && !failed && rows.length === 0;
  return { rows, meta, loading, empty, failed, retry, applyRow, removeRow };
}
