import type { FeedPost } from './feedModel';
import type { FeedStatus } from './pagination';
import type { Anchor } from './scrollAnchor';

// One feed page's restorable state: `posts`/`cursor`/`status` let us re-render the
// loaded feed without refetching (which would shift the newest-first list).
export type FeedSnapshot = {
  posts: FeedPost[];
  cursor?: string;
  status: FeedStatus;
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

  // The anchor goes with its snapshot: a fresh feed must not inherit the old position.
  static clearSnapshot(storage: Storage, key: string): void {
    storage.removeItem(key);
    storage.removeItem(FeedCache.anchorKey(key));
  }

  // The scroll anchor pins the position to a specific post rather than a raw pixel offset
  // (lazy images have no reserved height, so a pixel offset would land wrong). It lives
  // under its own key because the scroll hook rewrites it every throttled tick: kept
  // inside the snapshot, each tick would re-parse and re-encode up to 200 posts just to
  // change two numbers.
  static anchorKey(key: string): string {
    return `${key}#anchor`;
  }

  static readAnchor(storage: Storage, key: string): Anchor | null {
    const raw = storage.getItem(FeedCache.anchorKey(key));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Anchor;
    } catch {
      return null;
    }
  }

  static writeAnchor(storage: Storage, key: string, anchor: Anchor): void {
    try {
      storage.setItem(FeedCache.anchorKey(key), JSON.stringify(anchor));
    } catch {
      // Same best-effort rule as the snapshot: a full store must not break scrolling.
    }
  }
}
