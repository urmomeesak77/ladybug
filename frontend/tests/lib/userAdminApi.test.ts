// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserAdminApi } from '../../src/lib/userAdminApi';

function stubFetch(impl: (...args: unknown[]) => Promise<unknown>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const page = {
  data: [
    {
      hash: 'a1B2c3D4e5',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'member',
      email_verified_at: '2026-07-18 09:31:02',
      created_at: '2026-07-18 09:30:44',
      disabled_at: null,
      disabled_by: null,
    },
  ],
  meta: { current_page: 2, last_page: 3, per_page: 100, total: 214 },
};

describe('UserAdminApi.fetchPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the given page (credentials included) and maps the rows and meta on success', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => page }));

    const result = await UserAdminApi.fetchPage(2);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/users\?page=2$/),
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      // The raw snake_case payload is mapped through UserAdminModel to the camelCase row.
      expect(result.data[0].hash).toBe('a1B2c3D4e5');
      expect(result.data[0].emailVerifiedAt).toBe('2026-07-18 09:31:02');
      expect(result.data[0].isDisabled).toBe(false);
      expect(result.meta.current_page).toBe(2);
    }
  });

  it('treats a missing data array as an empty page rather than throwing', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ meta: page.meta }) }));

    const result = await UserAdminApi.fetchPage(1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('reports failure on a non-2xx response (e.g. 403 for a non-admin)', async () => {
    stubFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));

    const result = await UserAdminApi.fetchPage(1);

    expect(result.ok).toBe(false);
  });

  it('reports failure when fetch rejects (offline)', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await UserAdminApi.fetchPage(1);

    expect(result.ok).toBe(false);
  });
});
