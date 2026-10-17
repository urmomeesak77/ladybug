// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePost } from '../../src/hooks/usePost';
import { Api } from '../../src/lib/api';
import type { PostResult } from '../../src/lib/api';
import type { FeedPost } from '../../src/lib/feedModel';

afterEach(() => {
  vi.restoreAllMocks();
});

const post: FeedPost = {
  hash: 'abc1234567',
  title: 'Funny cat',
  permalink: '/posts/abc1234567',
  media: { kind: 'none' },
  hidden: null,
  author: 'alice',
  createdAt: '2026-07-22T12:00:00Z',
  commentCount: 0,
  mediaState: 'ready',
};

describe('usePost', () => {
  it('loads the post for the given hash', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    const { result } = renderHook(() => usePost('abc1234567'));

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(Api.fetchPost).toHaveBeenCalledWith('abc1234567');
  });

  it('maps a 404 to the notFound state', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({
      ok: false,
      error: { kind: 'notFound', status: 404 },
    });

    const { result } = renderHook(() => usePost('missing000'));

    await waitFor(() => expect(result.current.state.status).toBe('notFound'));
  });

  it('maps other failures to a retryable error state', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, post });

    const { result } = renderHook(() => usePost('abc1234567'));
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    result.current.retry();

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(fetchPost).toHaveBeenCalledTimes(2);
  });

  it('stays idle without a hash and never calls the API', () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost');

    const { result } = renderHook(() => usePost(undefined));

    expect(result.current.state.status).toBe('idle');
    expect(fetchPost).not.toHaveBeenCalled();
  });

  it('discards a stale response after navigating to another meme', async () => {
    let releaseFirst: (result: PostResult) => void = () => undefined;
    const first = new Promise<PostResult>((resolve) => {
      releaseFirst = resolve;
    });
    vi.spyOn(Api, 'fetchPost')
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, post: { ...post, hash: 'second0002', title: 'Second' } });

    const { result, rerender } = renderHook((hash: string) => usePost(hash), {
      initialProps: 'first000001',
    });
    rerender('second0002');
    await waitFor(() => expect(result.current.state.status).toBe('loaded'));

    // The slow first response arrives after navigation — it must not repaint the page.
    releaseFirst({ ok: true, post: { ...post, hash: 'first000001', title: 'First' } });
    await waitFor(() => expect(result.current.state.status).toBe('loaded'));

    const state = result.current.state;
    expect(state.status === 'loaded' && state.post.title).toBe('Second');
  });
});

describe('usePost applyModeration', () => {
  it('updates the loaded post hidden state', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    const { result } = renderHook(() => usePost('abc1234567'));
    await waitFor(() => expect(result.current.state.status).toBe('loaded'));

    act(() => { result.current.applyModeration('deleted'); });

    expect(result.current.state).toMatchObject({ status: 'loaded', post: { hidden: 'deleted' } });
  });
});

describe('usePost while the upload is processing (024)', () => {
  const processing: FeedPost = { ...post, media: { kind: 'none' }, mediaState: 'processing' };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Run timers forward and let the resulting fetches and re-renders settle.
  async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  it('re-fetches every two seconds and swaps in the finished post in place', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockResolvedValueOnce({ ok: true, post });

    const { result } = renderHook(() => usePost('abc1234567'));
    await advance(0);
    expect(result.current.state).toMatchObject({ status: 'loaded', post: { mediaState: 'processing' } });

    await advance(2000);
    expect(fetchPost).toHaveBeenCalledTimes(2);
    // A refresh never drops back to the loading spinner.
    expect(result.current.state.status).toBe('loaded');

    await advance(2000);
    expect(result.current.state).toMatchObject({ status: 'loaded', post: { mediaState: 'ready' } });

    await advance(10000);
    expect(fetchPost).toHaveBeenCalledTimes(3);
  });

  it('stops re-fetching once processing has failed', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockResolvedValue({ ok: true, post: { ...processing, mediaState: 'failed' } });

    const { result } = renderHook(() => usePost('abc1234567'));
    await advance(0);
    await advance(2000);
    expect(result.current.state).toMatchObject({ status: 'loaded', post: { mediaState: 'failed' } });

    await advance(10000);
    expect(fetchPost).toHaveBeenCalledTimes(2);
  });

  it('never re-fetches a post that is already ready', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderHook(() => usePost('abc1234567'));
    await advance(10000);

    expect(fetchPost).toHaveBeenCalledTimes(1);
  });

  it('stops re-fetching on unmount', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: processing });

    const { unmount } = renderHook(() => usePost('abc1234567'));
    await advance(0);
    unmount();
    await advance(10000);

    expect(fetchPost).toHaveBeenCalledTimes(1);
  });

  it('keeps the processing view through a failed refresh and tries again', async () => {
    const fetchPost = vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, post });

    const { result } = renderHook(() => usePost('abc1234567'));
    await advance(0);
    await advance(2000);
    expect(result.current.state).toMatchObject({ status: 'loaded', post: { mediaState: 'processing' } });

    await advance(2000);
    expect(fetchPost).toHaveBeenCalledTimes(3);
    expect(result.current.state).toMatchObject({ status: 'loaded', post: { mediaState: 'ready' } });
  });

  it('shows not-found when the post is removed while processing', async () => {
    vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'notFound', status: 404 } });

    const { result } = renderHook(() => usePost('abc1234567'));
    await advance(0);
    await advance(2000);

    expect(result.current.state.status).toBe('notFound');
  });

  it('drops a refresh that lands after navigating to another meme', async () => {
    let releaseRefresh: (result: PostResult) => void = () => undefined;
    vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: true, post: processing })
      .mockReturnValueOnce(new Promise<PostResult>((resolve) => {
        releaseRefresh = resolve;
      }))
      .mockResolvedValueOnce({ ok: true, post: { ...post, hash: 'second0002', title: 'Second' } });

    const { result, rerender } = renderHook((hash: string) => usePost(hash), {
      initialProps: 'abc1234567',
    });
    await advance(0);
    await advance(2000);
    rerender('second0002');
    await advance(0);

    releaseRefresh({ ok: true, post: { ...post, title: 'Stale' } });
    await advance(0);

    const state = result.current.state;
    expect(state.status === 'loaded' && state.post.title).toBe('Second');
  });
});
