// The raw moderation row as the admin API serializes it (AdminTrashpostResource). Snake_case
// mirrors the JSON; the render-ready ModerationRow below is the camelCase shape the UI reads.
export type RawModerationRow = {
  hash: string;
  thumbnail: string | null;
  title: string | null;
  type: string | null;
  username: string | null;
  created_at: string | null;
  activated_at: string | null;
  deleted_at: string | null;
  url: string;
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
  // Raw MySQL datetimes (Y-m-d H:i:s) straight from the server, or null when unset. The
  // absence of an activated_at/deleted_at is itself the "not activated"/"live" signal.
  createdAt: string | null;
  activatedAt: string | null;
  deletedAt: string | null;
  url: string;
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

  // The delete-confirm modal's body. Soft-delete phrased for the admin: hidden, restorable.
  // User-facing copy says "post" (site vocabulary), never the internal "meme"/"trashpost".
  static deleteConfirmMessage(title: string | null): string {
    if (title === null) {
      return 'This post will be hidden from the site. You can restore it later.';
    }
    return `The post "${title}" will be hidden from the site. You can restore it later.`;
  }

  static mapRow(raw: RawModerationRow): ModerationRow {
    return {
      hash: raw.hash,
      thumbnail: raw.thumbnail,
      title: raw.title,
      type: raw.type,
      username: raw.username,
      createdAt: raw.created_at,
      activatedAt: raw.activated_at,
      deletedAt: raw.deleted_at,
      url: raw.url,
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
}
