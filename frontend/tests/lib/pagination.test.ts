import { describe, expect, it } from 'vitest';

import type { FeedPost } from '../../src/lib/feedModel';
import { Pagination } from '../../src/lib/pagination';

// The reducer only inspects post counts and hashes, so a minimal stub suffices.
function posts(n: number): FeedPost[] {
  return Array.from({ length: n }, (_, i) => ({
    hash: `hash-${i}`,
    title: null,
    permalink: `/posts/hash-${i}`,
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
  }));
}

describe('nextStart', () => {
  it('returns the last item hash as the keyset cursor', () => {
    expect(Pagination.nextStart([{ hash: 'a' }, { hash: 'b' }])).toBe('b');
  });

  it('returns undefined for an empty list', () => {
    expect(Pagination.nextStart([])).toBeUndefined();
  });
});

describe('pageStart', () => {
  it('uses the URL page cursor as the first keyset start', () => {
    expect(Pagination.pageStart('hash-42')).toBe('hash-42');
  });

  it('trims surrounding whitespace from the cursor', () => {
    expect(Pagination.pageStart('  hash-42  ')).toBe('hash-42');
  });

  it('treats null/undefined/empty/blank as the newest page', () => {
    expect(Pagination.pageStart(null)).toBeUndefined();
    expect(Pagination.pageStart(undefined)).toBeUndefined();
    expect(Pagination.pageStart('')).toBeUndefined();
    expect(Pagination.pageStart('   ')).toBeUndefined();
  });
});

describe('isPageBreak', () => {
  it('is false below 200 and true once 200 entries are loaded', () => {
    expect(Pagination.isPageBreak(0)).toBe(false);
    expect(Pagination.isPageBreak(199)).toBe(false);
    expect(Pagination.isPageBreak(200)).toBe(true);
    expect(Pagination.isPageBreak(210)).toBe(true);
  });
});

describe('hasMore', () => {
  it('is true only for a full batch', () => {
    expect(Pagination.hasMore(posts(10), 10)).toBe(true);
    expect(Pagination.hasMore(posts(9), 10)).toBe(false);
    expect(Pagination.hasMore([], 10)).toBe(false);
  });
});

describe('feedReducer', () => {
  it('moves idle → loading on the first load', () => {
    const state = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });

    expect(state.status).toBe('loading');
  });

  it('appends a full batch and stays loadable', () => {
    const loading = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });
    const loaded = Pagination.reducer(loading, { type: 'loadSuccess', posts: posts(10), limit: 10 });

    expect(loaded.status).toBe('loaded');
    expect(loaded.posts).toHaveLength(10);
  });

  it('reaches end on a short batch', () => {
    const loading = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });
    const loaded = Pagination.reducer(loading, { type: 'loadSuccess', posts: posts(4), limit: 10 });

    expect(loaded.status).toBe('end');
  });

  it('reports empty when the very first batch is empty', () => {
    const loading = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });
    const loaded = Pagination.reducer(loading, { type: 'loadSuccess', posts: [], limit: 10 });

    expect(loaded.status).toBe('empty');
  });

  it('keeps already-loaded posts on error', () => {
    const loading = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });
    const loaded = Pagination.reducer(loading, { type: 'loadSuccess', posts: posts(10), limit: 10 });
    const more = Pagination.reducer(loaded, { type: 'loadStart' });
    const errored = Pagination.reducer(more, { type: 'loadError' });

    expect(errored.status).toBe('error');
    expect(errored.posts).toHaveLength(10);
  });

  it('blocks a duplicate loadStart while a load is in flight', () => {
    const loading = Pagination.reducer(Pagination.initialState, { type: 'loadStart' });
    const again = Pagination.reducer(loading, { type: 'loadStart' });

    expect(again).toBe(loading);
  });
});

describe('Pagination.reducer removePost', () => {
  const p = (hash: string): FeedPost => ({
    hash, title: null, permalink: `/posts/${hash}`,
    media: { kind: 'none' }, hidden: null, author: null, createdAt: null,
  });

  it('drops the named post and keeps the status', () => {
    const state = { status: 'loaded' as const, posts: [p('aaa'), p('bbb'), p('ccc')] };
    const next = Pagination.reducer(state, { type: 'removePost', hash: 'bbb' });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa', 'ccc']);
    expect(next.status).toBe('loaded');
  });

  it('is a no-op when the post is not present', () => {
    const state = { status: 'end' as const, posts: [p('aaa')] };
    const next = Pagination.reducer(state, { type: 'removePost', hash: 'zzz' });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa']);
  });
});

describe('Pagination.reducer removePosts', () => {
  const p = (hash: string): FeedPost => ({
    hash, title: null, permalink: `/posts/${hash}`,
    media: { kind: 'none' }, hidden: null, author: null, createdAt: null,
  });

  it('drops every named post in one pass and keeps the status', () => {
    const state = { status: 'loaded' as const, posts: [p('aaa'), p('bbb'), p('ccc'), p('ddd')] };
    const next = Pagination.reducer(state, { type: 'removePosts', hashes: ['bbb', 'ddd'] });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa', 'ccc']);
    expect(next.status).toBe('loaded');
  });

  it('is a no-op for an empty hash list', () => {
    const state = { status: 'end' as const, posts: [p('aaa')] };
    const next = Pagination.reducer(state, { type: 'removePosts', hashes: [] });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa']);
  });
});

describe('Pagination.staleHashes', () => {
  const list = (...hashes: string[]) => hashes.map((hash) => ({ hash }));

  it('flags a deleted newest post the server no longer returns', () => {
    // Loaded snapshot still has "daa" on top; the revalidated head dropped it.
    const stale = Pagination.staleHashes(list('daa', 'bbb', 'ccc'), ['bbb', 'ccc']);
    expect(stale).toEqual(['daa']);
  });

  it('flags a deleted post sandwiched between still-present posts', () => {
    const stale = Pagination.staleHashes(list('aaa', 'bbb', 'ccc'), ['aaa', 'ccc']);
    expect(stale).toEqual(['bbb']);
  });

  it('returns nothing when every loaded post is still present', () => {
    expect(Pagination.staleHashes(list('aaa', 'bbb'), ['aaa', 'bbb'])).toEqual([]);
  });

  it('never drops posts older than the revalidated window', () => {
    // "ddd" sits past the head the server returned, so its absence is unproven — keep it.
    const stale = Pagination.staleHashes(list('aaa', 'bbb', 'ccc', 'ddd'), ['aaa', 'ccc']);
    expect(stale).toEqual(['bbb']);
  });

  it('drops nothing when no loaded post appears in the head (no safe boundary)', () => {
    // A wholly different head (e.g. all-new posts) gives no anchor, so stay conservative.
    expect(Pagination.staleHashes(list('aaa', 'bbb'), ['xxx', 'yyy'])).toEqual([]);
    expect(Pagination.staleHashes(list('aaa', 'bbb'), [])).toEqual([]);
  });

  it('does not insert newly-appeared head posts, only removes deleted ones', () => {
    const stale = Pagination.staleHashes(list('daa', 'bbb', 'ccc'), ['new', 'bbb', 'ccc']);
    expect(stale).toEqual(['daa']);
  });
});
