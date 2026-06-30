import type { FeedPost } from './feedModel';
import type { FeedStatus } from './pagination';

// One feed page's restorable state. `posts`/`cursor`/`status` let us re-render the
// loaded feed without refetching (which would shift the newest-first list); the
// anchor pins the scroll position to a specific post rather than a raw pixel offset
// (lazy images have no reserved height, so a pixel offset would land wrong).
export type FeedSnapshot = {
  posts: FeedPost[];
  cursor?: string;
  status: FeedStatus;
  anchorHash: string | null;
  anchorOffset: number;
};

const NAMESPACE = 'ladybug.feed';

// Session-storage persistence for the feed's restorable state, converged onto one class.
export class FeedCache {
  // Keyed by feed URL so the newest page and each `?after=` page break persist apart.
  static feedKey(pathname: string, search: string): string {
    return `${NAMESPACE}:${pathname}${search}`;
  }

  static readSnapshot(storage: Storage, key: string): FeedSnapshot | null {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as FeedSnapshot;
    } catch {
      // A corrupt entry must degrade to a fresh feed, never throw on navigation.
      return null;
    }
  }

  static writeSnapshot(storage: Storage, key: string, snapshot: FeedSnapshot): void {
    try {
      storage.setItem(key, JSON.stringify(snapshot));
    } catch {
      // Quota or private-mode failures must not break the feed; restoration is best-effort.
    }
  }

  static clearSnapshot(storage: Storage, key: string): void {
    storage.removeItem(key);
  }

  // Read-modify-write so the scroll hook can update only the anchor without clobbering
  // the posts the feed hook wrote (and vice versa). No-op until a snapshot exists.
  static updateSnapshot(storage: Storage, key: string, partial: Partial<FeedSnapshot>): void {
    const existing = FeedCache.readSnapshot(storage, key);
    if (!existing) {
      return;
    }
    FeedCache.writeSnapshot(storage, key, { ...existing, ...partial });
  }
}
