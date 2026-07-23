// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeed } from '../../src/hooks/useFeed';
import { Api } from '../../src/lib/api';
import { FeedCache } from '../../src/lib/feedCache';
import type { FeedPost } from '../../src/lib/feedModel';

const CACHE_KEY = 'ladybug.feed:/test';

function post(hash: string): FeedPost {
  return {
    hash,
    title: hash,
    permalink: `/posts/${hash}`,
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
    commentCount: 0,
  };
}

function posts(count: number, prefix: string): FeedPost[] {
  const list: FeedPost[] = [];
  for (let i = 0; i < count; i++) {
    list.push(post(`${prefix}${String(i).padStart(7, '0')}`));
  }
  return list;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFeed', () => {
  it('auto-loads the first batch and persists the snapshot', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(result.current.state.posts).toHaveLength(10);
    // The settled feed is written to sessionStorage for Back/Forward restoration.
    const snapshot = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
    expect(snapshot?.posts).toHaveLength(10);
    expect(snapshot?.cursor).toBe('a0000009');
  });

  it('hydrates from an existing snapshot without refetching the loaded pages', () => {
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: posts(3, 'a'),
      cursor: 'a0000002',
      status: 'end',
      anchorHash: null,
      anchorOffset: 0,
    });
    // Background revalidation returns the same head, so nothing is dropped.
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(3, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));

    // The snapshot renders synchronously — no page reload, no list shift.
    expect(result.current.state.status).toBe('end');
    expect(result.current.state.posts).toHaveLength(3);
    // The only call is the single background head revalidation (start unset), never a
    // re-walk of the cursor pages.
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  });

  it('drops a post deleted server-side from a restored snapshot (background revalidation)', async () => {
    // The snapshot still carries a purged newest post ("daa"); the live head no longer does.
    const stale = [post('daa'), ...posts(9, 'a')];
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: stale,
      cursor: 'a0000008',
      status: 'loaded',
      anchorHash: null,
      anchorOffset: 0,
    });
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(9, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));

    // Renders the stale snapshot first (Back/refresh restores state), then reconciles.
    expect(result.current.state.posts[0].hash).toBe('daa');
    await waitFor(() => expect(result.current.state.posts.some((p) => p.hash === 'daa')).toBe(false));
    expect(result.current.state.posts).toHaveLength(9);
    // The shortened list is persisted, so a further refresh cannot resurrect the post.
    const snapshot = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
    expect(snapshot?.posts.some((p) => p.hash === 'daa')).toBe(false);
  });

  it('does not revalidate a fresh (link) navigation — it already reloaded page 1', async () => {
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: posts(3, 'a'),
      cursor: 'a0000002',
      status: 'end',
      anchorHash: null,
      anchorOffset: 0,
    });
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'b') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, true));

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    // Exactly one fetch: the fresh page-1 load. No extra revalidation pass on top.
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  });

  it('requests the first batch after the URL cursor', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    const { result } = renderHook(() => useFeed('cursor0001', CACHE_KEY, false));

    await waitFor(() => expect(result.current.state.status).toBe('empty'));
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: 'cursor0001' });
  });

  it('flags the error state but keeps the retryable load callback working', async () => {
    vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, posts: posts(2, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    await act(() => result.current.load());

    expect(result.current.state.status).toBe('end');
    expect(result.current.state.posts).toHaveLength(2);
  });

  it('ignores overlapping load calls while one is in flight', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));
    // Fire immediately while the mount load is still pending.
    await act(async () => {
      await Promise.all([result.current.load(), result.current.load()]);
    });

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(fetchFeed).toHaveBeenCalledTimes(1);
  });

  it('reports the page break once 200 entries are loaded', () => {
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: posts(200, 'a'),
      cursor: 'a0000199',
      status: 'loaded',
      anchorHash: null,
      anchorOffset: 0,
    });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));

    expect(result.current.atPageBreak).toBe(true);
    expect(result.current.canAutoLoad).toBe(false);
  });

  it('skips the snapshot and refetches from the top when fresh', async () => {
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: posts(3, 'a'),
      cursor: 'a0000002',
      status: 'end',
      anchorHash: 'a0000001',
      anchorOffset: 40,
    });
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'b') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, true));

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    // The snapshot's cursor must not leak into the fresh request: page 1 starts unset.
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
    expect(result.current.state.posts[0].hash).toBe('b0000000');
    // The old snapshot (posts + anchor) was cleared; the fresh load wrote a new one
    // anchored at the top.
    const saved = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
    expect(saved?.posts).toHaveLength(10);
    expect(saved?.anchorHash).toBeNull();
  });
});

describe('useFeed removePost', () => {
  it('drops a loaded post from the feed', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));
    await waitFor(() => expect(result.current.state.posts).toHaveLength(10));

    act(() => { result.current.removePost('a0000003'); });

    expect(result.current.state.posts.some((p) => p.hash === 'a0000003')).toBe(false);
    expect(result.current.state.posts).toHaveLength(9);
  });

  it('reseats the keyset cursor when the last (cursor) post is removed', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'a') })
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'b') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));
    await waitFor(() => expect(result.current.state.posts).toHaveLength(10));

    // Remove the last loaded post — it is the keyset cursor (a0000009).
    act(() => { result.current.removePost('a0000009'); });
    await act(() => result.current.load());

    // The next batch keys off the new last post, never the removed cursor (which would
    // dead-end the feed or duplicate the newest page).
    expect(fetchFeed).toHaveBeenLastCalledWith({ limit: 10, start: 'a0000008' });
  });

  it('keeps the cursor when a non-last post is removed', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'a') })
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'b') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, false));
    await waitFor(() => expect(result.current.state.posts).toHaveLength(10));

    act(() => { result.current.removePost('a0000003'); });
    await act(() => result.current.load());

    expect(fetchFeed).toHaveBeenLastCalledWith({ limit: 10, start: 'a0000009' });
  });
});
