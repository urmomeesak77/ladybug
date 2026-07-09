import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModerationApi } from '../../src/lib/moderationApi';

function stubFetch(impl: (...args: unknown[]) => Promise<unknown>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const page = {
  data: [
    {
      hash: 'Ab3-_9xQ12',
      thumbnail: null,
      title: 'A funny meme',
      type: 'image',
      username: 'alice',
      created_at: '2026-07-08 20:14:02',
      activated_at: '2026-07-09 08:01:10',
      deleted_at: null,
      url: '/posts/Ab3-_9xQ12',
    },
  ],
  meta: { current_page: 3, last_page: 4, per_page: 100, total: 331 },
};

describe('ModerationApi.fetchPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the given page and returns the parsed rows and meta on success', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => page }));

    const result = await ModerationApi.fetchPage(3);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\?page=3$/),
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].hash).toBe('Ab3-_9xQ12');
      expect(result.data[0].createdAt).toBe('2026-07-08 20:14:02');
      expect(result.data[0].activatedAt).toBe('2026-07-09 08:01:10');
      expect(result.data[0].deletedAt).toBeNull();
      expect(result.meta.current_page).toBe(3);
    }
  });

  it('reports failure on a non-2xx response', async () => {
    stubFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));

    const result = await ModerationApi.fetchPage(1);

    expect(result.ok).toBe(false);
  });

  it('reports failure when fetch rejects (offline)', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await ModerationApi.fetchPage(1);

    expect(result.ok).toBe(false);
  });
});

describe('ModerationApi.activate / deactivate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the activate endpoint (CSRF header) and returns the updated row', async () => {
    const updated = { ...page.data[0], activated_at: '2026-07-09 08:01:10' };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await ModerationApi.activate('Ab3-_9xQ12');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\/Ab3-_9xQ12\/activate$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': expect.anything() }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.activatedAt).toBe('2026-07-09 08:01:10');
    }
  });

  it('POSTs to the deactivate endpoint', async () => {
    const updated = { ...page.data[0], activated_at: null };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await ModerationApi.deactivate('Ab3-_9xQ12');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\/Ab3-_9xQ12\/deactivate$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.activatedAt).toBeNull();
    }
  });

  it('reports failure on a non-2xx response (e.g. 404 unknown hash)', async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    const result = await ModerationApi.activate('missing0000');

    expect(result.ok).toBe(false);
  });
});

describe('ModerationApi.remove / restore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs the meme (CSRF header) and returns the updated row', async () => {
    const updated = { ...page.data[0], deleted_at: '2026-07-09 09:30:00' };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await ModerationApi.remove('Ab3-_9xQ12');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\/Ab3-_9xQ12$/),
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': expect.anything() }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.deletedAt).toBe('2026-07-09 09:30:00');
    }
  });

  it('POSTs restore and returns the updated row', async () => {
    const updated = { ...page.data[0], deleted_at: null };
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: updated }) }));

    const result = await ModerationApi.restore('Ab3-_9xQ12');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\/Ab3-_9xQ12\/restore$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.deletedAt).toBeNull();
    }
  });

  it('reports failure when the action request rejects (offline)', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await ModerationApi.remove('Ab3-_9xQ12');

    expect(result.ok).toBe(false);
  });
});
