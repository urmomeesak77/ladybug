import { useEffect } from 'react';

import ErrorState from '../components/states/ErrorState';
import ModerationPagination from '../components/moderation/ModerationPagination';
import ModerationTable from '../components/moderation/ModerationTable';
import { useModeration } from '../hooks/useModeration';

// The /admin/trashposts moderation console (US1): the full-corpus table plus its numbered page
// links, with a loading indicator while a page is in flight, an explicit empty state for an
// empty corpus or an out-of-range page (FR-019), and a distinct error+retry state for a
// failed fetch — a destructive admin tool must never report a failure as "no entries." The
// route is gated to admin+ in US2; here the page trusts the server, which already refuses
// non-admin callers.
function ModerationPage() {
  const { rows, meta, loading, empty, failed, retry, applyRow, removeRow } = useModeration();

  useEffect(() => {
    document.title = 'Trashposts';
  }, []);

  return (
    <section className="moderation" aria-label="Trashposts">
      <h1>Trashposts</h1>
      {loading && <p className="moderation__status">Loading memes…</p>}
      {failed && <ErrorState onRetry={retry} />}
      {empty && <p className="moderation__status">No entries to moderate.</p>}
      {!loading && !empty && !failed && (
        <>
          <ModerationTable rows={rows} onApply={applyRow} onRemove={removeRow} />
          {meta !== null && <ModerationPagination meta={meta} />}
        </>
      )}
    </section>
  );
}

export default ModerationPage;
