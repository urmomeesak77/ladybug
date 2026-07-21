// Laravel's paginator meta: enough to derive the numbered page links and the current page.
// Shared by every admin console table (moderation, users) so the paging math lives once.
export type PageMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

// Page-link math for the admin console tables. Pure — no IO, no React (Principle II).
export class AdminPaging {
  // Every page number 1..last_page — the admin tables page 100 rows at a time, so the
  // count stays small enough to list in full.
  static pageLinks(meta: PageMeta): number[] {
    return Array.from({ length: meta.last_page }, (_unused, index) => index + 1);
  }

  // The ?page query value as a 1-based page number; absent, non-numeric, or below 1 all
  // fall back to page 1 so a hand-edited URL never breaks the fetch.
  static parsePage(raw: string | null): number {
    const page = Number(raw);
    return Number.isInteger(page) && page >= 1 ? page : 1;
  }
}
