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

describe('UserAdminApi.disable / enable', () => {
  const activeRaw = page.data[0];

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('POSTs to the disable endpoint with the CSRF header and maps the updated row', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    const updated = { ...activeRaw, disabled_at: '2026-07-20 10:00:00', disabled_by: 'Root' };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await UserAdminApi.disable('a1B2c3D4e5');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/users\/a1B2c3D4e5\/disable$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'tok123' }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.disabledAt).toBe('2026-07-20 10:00:00');
      expect(result.row.disabledBy).toBe('Root');
      expect(result.row.isDisabled).toBe(true);
    }
  });

  it('POSTs to the enable endpoint and maps the cleared row', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    const updated = { ...activeRaw, disabled_at: null, disabled_by: null };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await UserAdminApi.enable('a1B2c3D4e5');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/users\/a1B2c3D4e5\/enable$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.isDisabled).toBe(false);
    }
  });

  it('reports failure on a non-2xx response (e.g. 403 rank guard or 404 unknown hash)', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    stubFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));

    const result = await UserAdminApi.disable('a1B2c3D4e5');

    expect(result.ok).toBe(false);
  });

  it('reports failure when fetch rejects (offline)', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await UserAdminApi.enable('a1B2c3D4e5');

    expect(result.ok).toBe(false);
  });
});

describe('UserAdminApi.destroy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('DELETEs the account with the CSRF header and reports ok on a 204', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    const fetchMock = stubFetch(async () => ({ ok: true, status: 204 }));

    const result = await UserAdminApi.destroy('a1B2c3D4e5');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/users\/a1B2c3D4e5$/),
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'tok123' }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('reports not-ok on a non-2xx (e.g. 403 rank guard or 404 concurrent delete)', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    stubFetch(async () => ({ ok: false, status: 404 }));

    const result = await UserAdminApi.destroy('a1B2c3D4e5');

    expect(result.ok).toBe(false);
  });

  it('reports not-ok when fetch rejects (offline)', async () => {
    document.cookie = 'XSRF-TOKEN=tok123';
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await UserAdminApi.destroy('a1B2c3D4e5');

    expect(result.ok).toBe(false);
  });
});
