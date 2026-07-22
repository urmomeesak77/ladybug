import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedSnapshot } from '../../src/lib/feedCache';
import { FeedCache } from '../../src/lib/feedCache';

// Vitest unit specs run in Node (no DOM), so inject an in-memory Storage stub.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const sample: FeedSnapshot = {
  posts: [{
    hash: 'a',
    title: null,
    permalink: '/posts/a',
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
  }],
  cursor: 'a',
  status: 'loaded',
  anchorHash: null,
  anchorOffset: 0,
};

describe('feedKey', () => {
  it('uses the pathname for the newest page', () => {
    expect(FeedCache.feedKey('/', '')).toBe('ladybug.feed:/');
  });

  it('includes the search so each page break keys separately', () => {
    expect(FeedCache.feedKey('/', '?after=xyz')).toBe('ladybug.feed:/?after=xyz');
  });
});

describe('read/write/clear snapshot', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('round-trips a snapshot', () => {
    FeedCache.writeSnapshot(storage, 'k', sample);
    expect(FeedCache.readSnapshot(storage, 'k')).toEqual(sample);
  });

  it('returns null for a missing key', () => {
    expect(FeedCache.readSnapshot(storage, 'missing')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    storage.setItem('k', '{ not json');
    expect(FeedCache.readSnapshot(storage, 'k')).toBeNull();
  });

  it('swallows a setItem failure (e.g. quota) instead of throwing', () => {
    const throwing = { ...memoryStorage(), setItem: vi.fn(() => { throw new Error('quota'); }) } as Storage;
    expect(() => FeedCache.writeSnapshot(throwing, 'k', sample)).not.toThrow();
  });

  it('removes a snapshot', () => {
    FeedCache.writeSnapshot(storage, 'k', sample);
    FeedCache.clearSnapshot(storage, 'k');
    expect(FeedCache.readSnapshot(storage, 'k')).toBeNull();
  });
});

describe('updateSnapshot', () => {
  it('merges a partial into an existing snapshot', () => {
    const storage = memoryStorage();
    FeedCache.writeSnapshot(storage, 'k', sample);
    FeedCache.updateSnapshot(storage, 'k', { anchorHash: 'a', anchorOffset: 120 });
    expect(FeedCache.readSnapshot(storage, 'k')).toEqual({ ...sample, anchorHash: 'a', anchorOffset: 120 });
  });

  it('is a no-op when no snapshot exists yet', () => {
    const storage = memoryStorage();
    FeedCache.updateSnapshot(storage, 'k', { anchorHash: 'a', anchorOffset: 1 });
    expect(FeedCache.readSnapshot(storage, 'k')).toBeNull();
  });
});
