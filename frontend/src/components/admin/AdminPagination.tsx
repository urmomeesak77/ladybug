import { Link } from 'react-router-dom';

import type { PageMeta } from '../../lib/adminPaging';
import { AdminPaging } from '../../lib/adminPaging';

// Numbered page links that write ?page=N into the URL (keeping the pathname), so paging is
// bookmarkable and refresh-safe (Principle III). The bar is windowed (AdminPaging.window):
// first/last/current±1 with an "…" gap for hidden runs, so a large roster does not render
// hundreds of links. The current page is marked aria-current. Shared by every admin console
// table; `label` names the nav for screen readers, since a page may carry more than one
// paginated table.
function AdminPagination({ meta, label }: { meta: PageMeta; label: string }) {
  const items = AdminPaging.window(meta);

  return (
    <nav className="moderation-pagination" aria-label={label}>
      <ul>
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            // Decorative gap: the surrounding links and aria-current already convey position,
            // so the ellipsis is hidden from assistive tech (Principle IV).
            <li key={`gap-${index}`} className="moderation-pagination__gap" aria-hidden="true">…</li>
          ) : (
            <li key={item}>
              <Link
                to={{ search: `?page=${item}` }}
                aria-current={item === meta.current_page ? 'page' : undefined}
              >
                {item}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

export default AdminPagination;
