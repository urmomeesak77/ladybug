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
    commentCount: 0,
  }],
  cursor: 'a',
  status: 'loaded',
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

describe('read/write anchor', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('round-trips an anchor', () => {
    FeedCache.writeAnchor(storage, 'k', { anchorHash: 'a', anchorOffset: 120 });
    expect(FeedCache.readAnchor(storage, 'k')).toEqual({ anchorHash: 'a', anchorOffset: 120 });
  });

  // The scroll hook writes the anchor on every throttled tick; touching the snapshot there
  // would re-encode up to 200 posts just to move two numbers.
  it('stores the anchor apart from the snapshot, leaving the snapshot untouched', () => {
    FeedCache.writeSnapshot(storage, 'k', sample);
    const snapshotJson = storage.getItem('k');
    FeedCache.writeAnchor(storage, 'k', { anchorHash: 'a', anchorOffset: 120 });
    expect(storage.getItem('k')).toBe(snapshotJson);
    expect(FeedCache.readSnapshot(storage, 'k')).toEqual(sample);
  });

  it('returns null for a missing or corrupt anchor', () => {
    expect(FeedCache.readAnchor(storage, 'k')).toBeNull();
    storage.setItem(FeedCache.anchorKey('k'), '{ not json');
    expect(FeedCache.readAnchor(storage, 'k')).toBeNull();
  });

  it('swallows a setItem failure (e.g. quota) instead of throwing', () => {
    const throwing = { ...memoryStorage(), setItem: vi.fn(() => { throw new Error('quota'); }) } as Storage;
    expect(() => FeedCache.writeAnchor(throwing, 'k', { anchorHash: 'a', anchorOffset: 0 })).not.toThrow();
  });

  it('clears the anchor together with its snapshot', () => {
    FeedCache.writeSnapshot(storage, 'k', sample);
    FeedCache.writeAnchor(storage, 'k', { anchorHash: 'a', anchorOffset: 120 });
    FeedCache.clearSnapshot(storage, 'k');
    expect(FeedCache.readAnchor(storage, 'k')).toBeNull();
  });
});
