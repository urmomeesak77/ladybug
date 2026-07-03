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
  return { hash, title: hash, permalink: `/posts/${hash}`, media: { kind: 'none' } };
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

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY));

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(result.current.state.posts).toHaveLength(10);
    // The settled feed is written to sessionStorage for Back/Forward restoration.
    const snapshot = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
    expect(snapshot?.posts).toHaveLength(10);
    expect(snapshot?.cursor).toBe('a0000009');
  });

  it('hydrates from an existing snapshot instead of refetching', () => {
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
      posts: posts(3, 'a'),
      cursor: 'a0000002',
      status: 'end',
      anchorHash: null,
      anchorOffset: 0,
    });
    const fetchFeed = vi.spyOn(Api, 'fetchFeed');

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY));

    expect(result.current.state.status).toBe('end');
    expect(result.current.state.posts).toHaveLength(3);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('requests the first batch after the URL cursor', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    const { result } = renderHook(() => useFeed('cursor0001', CACHE_KEY));

    await waitFor(() => expect(result.current.state.status).toBe('empty'));
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: 'cursor0001' });
  });

  it('flags the error state but keeps the retryable load callback working', async () => {
    vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, posts: posts(2, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY));
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    await act(() => result.current.load());

    expect(result.current.state.status).toBe('end');
    expect(result.current.state.posts).toHaveLength(2);
  });

  it('ignores overlapping load calls while one is in flight', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'a') });

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY));
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

    const { result } = renderHook(() => useFeed(undefined, CACHE_KEY));

    expect(result.current.atPageBreak).toBe(true);
    expect(result.current.canAutoLoad).toBe(false);
  });
});
