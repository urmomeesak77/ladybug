import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ModerationApi } from '../lib/moderationApi';
import type { ModerationMeta, ModerationRow } from '../lib/moderationModel';
import { ModerationModel } from '../lib/moderationModel';

// The last settled fetch: which page it was for, and its result. `loading` is derived by
// comparing this page to the one the URL currently asks for, so the setter is only ever
// called from the async callback — never synchronously inside the effect.
type Loaded = { page: number; rows: ModerationRow[]; meta: ModerationMeta | null };

// Loads the moderation page named by the URL's ?page and re-loads whenever that page
// changes (Back/Forward/refresh restore the exact page — FR-004/FR-005). A failed fetch
// settles into the same empty state the empty corpus produces; `empty` distinguishes a
// settled no-rows result from the in-flight one for the page's explicit empty state.
export function useModeration() {
  const [searchParams] = useSearchParams();
  const page = ModerationModel.parsePage(searchParams.get('page'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    // A slow response that resolves after the admin paged elsewhere must not paint over
    // the newer page: the cleanup flips `active` so the stale result is dropped.
    let active = true;
    void ModerationApi.fetchPage(page).then((result) => {
      if (!active) {
        return;
      }
      setLoaded({
        page,
        rows: result.ok ? result.data : [],
        meta: result.ok ? result.meta : null,
      });
    });
    return () => {
      active = false;
    };
  }, [page]);

  // Replace one row in place after a moderation action (FR-017): the admin stays on the
  // current page (no refetch, so `loaded.page` is untouched) and only the acted-on row's
  // state changes. A no-op if the row isn't on the loaded page.
  function applyRow(updated: ModerationRow): void {
    setLoaded((current) => {
      if (current === null) {
        return current;
      }
      return {
        ...current,
        rows: current.rows.map((row) => (row.hash === updated.hash ? updated : row)),
      };
    });
  }

  const loading = loaded === null || loaded.page !== page;
  const rows = loading ? [] : loaded.rows;
  const meta = loading ? null : loaded.meta;
  const empty = !loading && rows.length === 0;
  return { rows, meta, loading, empty, applyRow };
}
