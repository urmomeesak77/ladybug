// Laravel's paginator meta: enough to derive the numbered page links and the current page.
// Shared by every admin console table (moderation, users) so the paging math lives once.
export type PageMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

// One entry in the windowed page bar: a page number to link, or a gap standing in for a run
// of hidden pages.
export type PageItem = number | 'ellipsis';

// Page-link math for the admin console tables. Pure — no IO, no React (Principle II).
export class AdminPaging {
  // The windowed page bar: always the first and last page plus the current page and its
  // immediate neighbours, with an 'ellipsis' marker wherever a run of pages is hidden. This
  // keeps the bar to a handful of links even when the roster grows to hundreds of pages
  // (100 rows/page), instead of rendering one link per page. A gap of a single page is shown
  // as that page rather than an ellipsis — hiding one number behind "…" only loses a click.
  static window(meta: PageMeta): PageItem[] {
    const last = Math.max(meta.last_page, 1);
    const current = Math.min(Math.max(meta.current_page, 1), last);
    const shown = new Set<number>([1, last]);
    for (let page = current - 1; page <= current + 1; page += 1) {
      if (page >= 1 && page <= last) {
        shown.add(page);
      }
    }

    const sorted = [...shown].sort((left, right) => left - right);
    const items: PageItem[] = [];
    let previous = 0;
    for (const page of sorted) {
      if (previous !== 0 && page - previous > 1) {
        items.push(page - previous === 2 ? previous + 1 : 'ellipsis');
      }
      items.push(page);
      previous = page;
    }
    return items;
  }

  // The ?page query value as a 1-based page number; absent, non-numeric, or below 1 all
  // fall back to page 1 so a hand-edited URL never breaks the fetch.
  static parsePage(raw: string | null): number {
    const page = Number(raw);
    return Number.isInteger(page) && page >= 1 ? page : 1;
  }
}
