// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModeration } from '../../src/hooks/useModeration';
import { ModerationApi } from '../../src/lib/moderationApi';
import type { ModerationRow } from '../../src/lib/moderationModel';

afterEach(() => {
  vi.restoreAllMocks();
});

const row: ModerationRow = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08 20:14:02',
  activatedAt: '2026-07-09 08:01:10',
  deletedAt: null,
  url: '/posts/Ab3-_9xQ12',
};

const meta = { current_page: 1, last_page: 1, per_page: 100, total: 1 };

function wrapperFor(initialPath: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
  };
}

describe('useModeration', () => {
  it('loads page 1 by default and exposes rows and meta', async () => {
    const fetchPage = vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledWith(1);
    expect(result.current.rows).toEqual([row]);
    expect(result.current.meta).toEqual(meta);
    expect(result.current.empty).toBe(false);
  });

  it('reads ?page from the URL and fetches that page', async () => {
    const fetchPage = vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes?page=4') });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(4));
  });

  it('reports empty when the page has no rows', async () => {
    vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: true, data: [], meta: { ...meta, total: 0 } });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.empty).toBe(true);
  });

  it('settles into an empty state when the fetch fails', async () => {
    vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.meta).toBeNull();
    expect(result.current.empty).toBe(true);
  });

  it('applyRow replaces just the matching row and keeps the current page', async () => {
    const rowB: ModerationRow = { ...row, hash: 'Zz9-_0000A', activatedAt: null };
    const fetchPage = vi
      .spyOn(ModerationApi, 'fetchPage')
      .mockResolvedValue({ ok: true, data: [row, rowB], meta: { ...meta, total: 2 } });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes?page=3') });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledTimes(1);

    act(() => result.current.applyRow({ ...rowB, activatedAt: '2026-07-09 08:01:10' }));

    // Only rowB is replaced; row is untouched; no refetch (still page 3).
    expect(result.current.rows[0]).toEqual(row);
    expect(result.current.rows[1].activatedAt).toBe('2026-07-09 08:01:10');
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('applyRow also carries a deleted-state change in place', async () => {
    vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes') });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.applyRow({ ...row, deletedAt: '2026-07-09 09:30:00' }));

    expect(result.current.rows[0].deletedAt).toBe('2026-07-09 09:30:00');
  });

  it('drops a response that resolves after the hook unmounts', async () => {
    let resolveFetch: (result: { ok: true; data: ModerationRow[]; meta: typeof meta }) => void = () => undefined;
    const pending = new Promise<{ ok: true; data: ModerationRow[]; meta: typeof meta }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(ModerationApi, 'fetchPage').mockReturnValue(pending);

    const { result, unmount } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/memes') });
    expect(result.current.loading).toBe(true);

    // Unmount cancels the in-flight load; the late response must resolve without updating
    // (or throwing on) the unmounted hook.
    unmount();
    resolveFetch({ ok: true, data: [row], meta });
    await Promise.resolve();
  });
});
