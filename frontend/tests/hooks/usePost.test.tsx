// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
