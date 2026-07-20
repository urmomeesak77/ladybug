import { Link } from 'react-router-dom';

import type { PageMeta } from '../../lib/adminPaging';
import { AdminPaging } from '../../lib/adminPaging';

// Numbered page links that write ?page=N into the URL (keeping the pathname), so paging is
// bookmarkable and refresh-safe (Principle III). The current page is marked aria-current.
// Shared by every admin console table; `label` names the nav for screen readers, since a
// page may carry more than one paginated table.
function AdminPagination({ meta, label }: { meta: PageMeta; label: string }) {
  const pages = AdminPaging.pageLinks(meta);

  return (
    <nav className="moderation-pagination" aria-label={label}>
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

export default AdminPagination;
