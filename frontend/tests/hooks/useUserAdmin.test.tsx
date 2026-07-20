// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserAdmin } from '../../src/hooks/useUserAdmin';
import { UserAdminApi } from '../../src/lib/userAdminApi';
import type { UserRow } from '../../src/lib/userAdminModel';

afterEach(() => {
  vi.restoreAllMocks();
});

const row: UserRow = {
  hash: 'a1B2c3D4e5',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'member',
  emailVerifiedAt: '2026-07-18 09:31:02',
  createdAt: '2026-07-18 09:30:44',
  disabledAt: null,
  disabledBy: null,
  isDisabled: false,
};

const meta = { current_page: 1, last_page: 1, per_page: 100, total: 1 };

function wrapperFor(initialPath: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
  };
}

describe('useUserAdmin', () => {
  it('loads page 1 by default and exposes rows and meta', async () => {
    const fetchPage = vi.spyOn(UserAdminApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledWith(1);
    expect(result.current.rows).toEqual([row]);
    expect(result.current.meta).toEqual(meta);
    expect(result.current.empty).toBe(false);
  });

  it('reads ?page from the URL and fetches that page', async () => {
    const fetchPage = vi.spyOn(UserAdminApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users?page=3') });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(3));
  });

  it('reports empty when the page has no rows', async () => {
    vi.spyOn(UserAdminApi, 'fetchPage').mockResolvedValue({ ok: true, data: [], meta: { ...meta, total: 0 } });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.empty).toBe(true);
  });

  it('reports a failed fetch as failed, never empty', async () => {
    vi.spyOn(UserAdminApi, 'fetchPage').mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.meta).toBeNull();
    expect(result.current.failed).toBe(true);
    expect(result.current.empty).toBe(false);
  });

  it('retry refetches the current page', async () => {
    const fetchPage = vi.spyOn(UserAdminApi, 'fetchPage');
    fetchPage.mockResolvedValueOnce({ ok: false });
    fetchPage.mockResolvedValueOnce({ ok: true, data: [], meta });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('applyRow replaces just the matching row and keeps the current page', async () => {
    const rowB: UserRow = { ...row, hash: 'Zz9Yy8Xx7w', name: 'Spammer' };
    const fetchPage = vi
      .spyOn(UserAdminApi, 'fetchPage')
      .mockResolvedValue({ ok: true, data: [row, rowB], meta: { ...meta, total: 2 } });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users?page=2') });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledTimes(1);

    act(() => result.current.applyRow({ ...rowB, disabledAt: '2026-07-19 11:20:00', disabledBy: 'Root', isDisabled: true }));

    expect(result.current.rows[0]).toEqual(row);
    expect(result.current.rows[1].isDisabled).toBe(true);
    // No refetch: the admin stays on page 2 (FR-016).
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('leaves every row untouched when applyRow targets a row not on the page (failed action)', async () => {
    // A failed disable/enable never calls applyRow; and applyRow itself is a no-op for a row
    // that is not on the current page — either way the loaded rows stay exactly as they were
    // (contract §5: never paint state the server did not confirm).
    vi.spyOn(UserAdminApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    const { result } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.rows;

    act(() => result.current.applyRow({ ...row, hash: 'notonpage9', isDisabled: true }));

    expect(result.current.rows).toEqual(before);
  });

  it('drops a response that resolves after the hook unmounts', async () => {
    let resolveFetch: (result: { ok: true; data: UserRow[]; meta: typeof meta }) => void = () => undefined;
    const pending = new Promise<{ ok: true; data: UserRow[]; meta: typeof meta }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(UserAdminApi, 'fetchPage').mockReturnValue(pending);

    const { result, unmount } = renderHook(() => useUserAdmin(), { wrapper: wrapperFor('/admin/users') });
    expect(result.current.loading).toBe(true);

    unmount();
    resolveFetch({ ok: true, data: [row], meta });
    await Promise.resolve();
  });
});
