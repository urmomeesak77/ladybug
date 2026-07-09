// The raw moderation row as the admin API serializes it (AdminTrashpostResource). Snake_case
// mirrors the JSON; the render-ready ModerationRow below is the camelCase shape the UI reads.
export type RawModerationRow = {
  hash: string;
  thumbnail: string | null;
  type: string | null;
  username: string | null;
  created_at: string;
  activated: boolean;
  deleted: boolean;
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
  type: string | null;
  username: string | null;
  createdAt: string;
  activated: boolean;
  deleted: boolean;
  url: string;
};

// Pure mapping/derivation for the moderation table: raw→row, page-link math, state labels.
// IO lives in lib/moderationApi; this class never touches the network (Principle II).
export class ModerationModel {
  static mapRow(raw: RawModerationRow): ModerationRow {
    return {
      hash: raw.hash,
      thumbnail: raw.thumbnail,
      type: raw.type,
      username: raw.username,
      createdAt: raw.created_at,
      activated: raw.activated,
      deleted: raw.deleted,
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

  // State conveyed as text (paired with an icon in the row) — never color alone (FR-014).
  static activationLabel(activated: boolean): string {
    return activated ? 'Activated' : 'Not activated';
  }

  static deletionLabel(deleted: boolean): string {
    return deleted ? 'Deleted' : 'Not deleted';
  }
}
