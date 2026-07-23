// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useComments } from '../../src/hooks/useComments';
import { CommentApi } from '../../src/lib/commentApi';
import type { CommentPage } from '../../src/lib/commentModel';

afterEach(() => {
  vi.restoreAllMocks();
});

function page(overrides: Partial<CommentPage> = {}): CommentPage {
  return { comments: [], total: 0, cursor: null, hasMore: false, ...overrides };
}

function comment(hash: string) {
  return { hash, body: 'x', author: 'alice', hidden: false, createdAt: null };
}

describe('useComments initial load', () => {
  it('loads the newest batch on mount and exposes comments, total and has-more', async () => {
    const first = page({ comments: [comment('New0000001')], total: 12, cursor: 'cursor-1', hasMore: true });
    const fetchPage = vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: first });

    const { result } = renderHook(() => useComments('Post000001'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledWith('Post000001', undefined);
    expect(result.current.comments).toEqual(first.comments);
    expect(result.current.total).toBe(12);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.failed).toBe(false);
  });

  it('reports a failed initial load distinctly from an empty post', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useComments('Post000001'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(true);
    expect(result.current.comments).toEqual([]);
  });
});

describe('useComments loadMore', () => {
  it('appends the next older batch and advances the cursor and has-more', async () => {
    const first = page({ comments: [comment('New0000001')], total: 12, cursor: 'cursor-1', hasMore: true });
    const older = page({ comments: [comment('Old0000001')], total: 12, cursor: null, hasMore: false });
    const fetchPage = vi.spyOn(CommentApi, 'fetchPage');
    fetchPage.mockResolvedValueOnce({ ok: true, page: first });
    fetchPage.mockResolvedValueOnce({ ok: true, page: older });

    const { result } = renderHook(() => useComments('Post000001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.comments).toHaveLength(2));
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'Post000001', 'cursor-1');
    expect(result.current.comments.map((c) => c.hash)).toEqual(['New0000001', 'Old0000001']);
    expect(result.current.hasMore).toBe(false);
  });

  it('does nothing when there is no more to load', async () => {
    const first = page({ comments: [comment('New0000001')], total: 1, cursor: null, hasMore: false });
    const fetchPage = vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: first });

    const { result } = renderHook(() => useComments('Post000001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('useComments submit', () => {
  it('prepends the created comment in place and increments the count', async () => {
    const first = page({ comments: [comment('Old0000001')], total: 1, cursor: null, hasMore: false });
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: first });
    const fresh = comment('New0000001');
    const create = vi.spyOn(CommentApi, 'create').mockResolvedValue({ ok: true, comment: fresh });

    const { result } = renderHook(() => useComments('Post000001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submit('a new comment');
    });

    expect(create).toHaveBeenCalledWith('Post000001', 'a new comment');
    expect(result.current.comments.map((c) => c.hash)).toEqual(['New0000001', 'Old0000001']);
    expect(result.current.total).toBe(2);
  });

  it('returns the failure and leaves the list unchanged on a failed create', async () => {
    const first = page({ comments: [comment('Old0000001')], total: 1, cursor: null, hasMore: false });
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: first });
    vi.spyOn(CommentApi, 'create').mockResolvedValue({ ok: false, kind: 'validation', errors: { body: ['required'] } });

    const { result } = renderHook(() => useComments('Post000001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.submit('');
    });

    expect(outcome).toEqual({ ok: false, kind: 'validation', errors: { body: ['required'] } });
    expect(result.current.comments.map((c) => c.hash)).toEqual(['Old0000001']);
    expect(result.current.total).toBe(1);
  });
});
