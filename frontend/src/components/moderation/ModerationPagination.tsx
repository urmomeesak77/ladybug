import AdminPagination from '../admin/AdminPagination';
import type { ModerationMeta } from '../../lib/moderationModel';

// Numbered page links that write ?page=N into the URL (keeping the pathname), so paging is
// bookmarkable and refresh-safe (FR-004/FR-005). The rendering is shared with the other
// admin consoles (012); this wrapper keeps the 010 props and markup unchanged.
function ModerationPagination({ meta }: { meta: ModerationMeta }) {
  return <AdminPagination meta={meta} label="Moderation pages" />;
}

export default ModerationPagination;
