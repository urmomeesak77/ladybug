// The raw moderation row as the admin API serializes it (AdminTrashpostResource). Snake_case
// mirrors the JSON; the render-ready ModerationRow below is the camelCase shape the UI reads.
export type RawModerationRow = {
  hash: string;
  thumbnail: string | null;
  title: string | null;
  type: string | null;
  username: string | null;
  // The OWNING ACCOUNT's rating, not a per-meme value; null iff the meme has no
  // resolvable owner. The server never omits the key (contract §1).
  rating: number | null;
  created_at: string | null;
  activated_at: string | null;
  deleted_at: string | null;
};

// Laravel's paginator meta: enough to derive the numbered page links and the current page.
export type ModerationMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

export type ModerationRow = {
  hash: string;
  thumbnail: string | null;
  title: string | null;
  type: string | null;
  username: string | null;
  rating: number | null;
  // Raw MySQL datetimes (Y-m-d H:i:s) straight from the server, or null when unset. The
  // absence of an activated_at/deleted_at is itself the "not activated"/"live" signal.
  createdAt: string | null;
  activatedAt: string | null;
  deletedAt: string | null;
};

// The table shows at most this many title characters; the full title moves into a tooltip.
const TITLE_MAX = 20;

// Pure mapping/derivation for the moderation table: raw→row, page-link math, state labels.
// IO lives in lib/moderationApi; this class never touches the network (Principle II).
export class ModerationModel {
  // The date part of a raw MySQL datetime (Y-m-d H:i:s); the full value lives in the
  // cell's hover tooltip so the table stays narrow without losing information.
  static dateOnly(value: string | null): string | null {
    return value === null ? null : value.slice(0, 10);
  }

  // A title capped at TITLE_MAX characters (ellipsis appended, dangling space trimmed);
  // short titles pass through unchanged so the caller can tell nothing was cut.
  static shortTitle(title: string | null): string | null {
    if (title === null || title.length <= TITLE_MAX) {
      return title;
    }
    return `${title.slice(0, TITLE_MAX).trimEnd()}…`;
  }

  // The delete-confirm body for a live post: both outcomes explained — soft delete is
  // reversible, permanent delete is not. User-facing copy says "post" (site vocabulary),
  // never the internal "meme"/"trashpost".
  static deleteConfirmMessage(title: string | null): string {
    const subject = title === null ? 'this post' : `the post "${title}"`;
    return `Soft delete hides ${subject} from the site — you can restore it later. `
      + 'Permanent delete removes the post and its files forever.';
  }

  // The confirm body for an already soft-deleted post, where only permanent deletion (and
  // cancel) is on offer. User-facing copy says "post" (site vocabulary).
  static purgeConfirmMessage(title: string | null): string {
    const subject = title === null ? 'This post' : `The post "${title}"`;
    return `${subject} is already hidden from the site. Permanent delete removes it and its files forever.`;
  }

  // The rating cell's text. A missing owner reads as an explicit "no account" rather
  // than 0 or an empty cell (FR-021): 0 is a real rating an account can hold, so the
  // two states must never look alike. Text carries the meaning, never colour alone.
  static ratingLabel(rating: number | null): string {
    return rating === null ? 'no account' : String(rating);
  }

  static mapRow(raw: RawModerationRow): ModerationRow {
    return {
      hash: raw.hash,
      thumbnail: raw.thumbnail,
      title: raw.title,
      type: raw.type,
      username: raw.username,
      rating: raw.rating,
      createdAt: raw.created_at,
      activatedAt: raw.activated_at,
      deletedAt: raw.deleted_at,
    };
  }

  // Every page number 1..last_page — the table pages 100 rows at a time, so the count
  // stays small enough to list in full.
  static pageLinks(meta: ModerationMeta): number[] {
    return Array.from({ length: meta.last_page }, (_unused, index) => index + 1);
  }

  // The ?page query value as a 1-based page number; absent, non-numeric, or below 1 all
  // fall back to page 1 so a hand-edited URL never breaks the fetch (FR-005).
  static parsePage(raw: string | null): number {
    const page = Number(raw);
    return Number.isInteger(page) && page >= 1 ? page : 1;
  }

  // Replace one row in place after a moderation action (FR-017); a no-op when the
  // row is not on the page.
  static replaceRow(rows: ModerationRow[], updated: ModerationRow): ModerationRow[] {
    return rows.map((row) => (row.hash === updated.hash ? updated : row));
  }

  // Drop a purged row (the server returned 204 — it no longer exists).
  static dropRow(rows: ModerationRow[], hash: string): ModerationRow[] {
    return rows.filter((row) => row.hash !== hash);
  }
}
