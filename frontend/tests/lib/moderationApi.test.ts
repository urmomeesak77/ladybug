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
      type: 'image',
      username: 'alice',
      created_at: '2026-07-08T20:14:02.000000Z',
      activated: true,
      deleted: false,
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
      expect(result.data[0].createdAt).toBe('2026-07-08T20:14:02.000000Z');
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
