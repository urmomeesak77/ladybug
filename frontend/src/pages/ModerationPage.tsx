import { useEffect } from 'react';

import ModerationPagination from '../components/moderation/ModerationPagination';
import ModerationTable from '../components/moderation/ModerationTable';
import { useModeration } from '../hooks/useModeration';

// The /admin/memes moderation console (US1): the full-corpus table plus its numbered page
// links, with a loading indicator while a page is in flight and an explicit empty state
// for an empty corpus or an out-of-range page (FR-019). The route is gated to admin+ in
// US2; here the page trusts the server, which already refuses non-admin callers.
function ModerationPage() {
  const { rows, meta, loading, empty } = useModeration();

  useEffect(() => {
    document.title = 'Moderation';
  }, []);

  return (
    <section className="moderation" aria-label="Meme moderation">
      <h1>Meme moderation</h1>
      {loading && <p className="moderation__status">Loading memes…</p>}
      {empty && <p className="moderation__status">No entries to moderate.</p>}
      {!loading && !empty && (
        <>
          <ModerationTable rows={rows} />
          {meta !== null && <ModerationPagination meta={meta} />}
        </>
      )}
    </section>
  );
}

export default ModerationPage;
