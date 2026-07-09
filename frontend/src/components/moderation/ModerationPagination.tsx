import { Link } from 'react-router-dom';

import type { ModerationMeta } from '../../lib/moderationModel';
import { ModerationModel } from '../../lib/moderationModel';

// Numbered page links that write ?page=N into the URL (keeping the pathname), so paging is
// bookmarkable and refresh-safe (FR-004/FR-005). The current page is marked aria-current.
function ModerationPagination({ meta }: { meta: ModerationMeta }) {
  const pages = ModerationModel.pageLinks(meta);

  return (
    <nav className="moderation-pagination" aria-label="Moderation pages">
      <ul>
        {pages.map((page) => (
          <li key={page}>
            <Link
              to={{ search: `?page=${page}` }}
              aria-current={page === meta.current_page ? 'page' : undefined}
            >
              {page}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default ModerationPagination;
