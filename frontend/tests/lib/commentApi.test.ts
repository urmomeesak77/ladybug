// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommentApi } from '../../src/lib/commentApi';

function stubFetch(impl: (...args: unknown[]) => Promise<unknown>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rawPage = {
  data: [
    {
      hash: 'Ab3-xY9_q2',
      body: 'first line\nsecond line',
      username: 'alice',
      hidden: false,
      created_at: '2026-07-23T10:15:00.000000Z',
    },
  ],
  meta: { total: 42, next_cursor: 'Y3Vyc29y', has_more: true },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentApi.fetchPage', () => {
  it('requests the nested comments URL and maps the page on success', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => rawPage }));

    const result = await CommentApi.fetchPage('Ab3-xY9_q2');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/posts\/Ab3-xY9_q2\/comments$/),
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page.comments).toHaveLength(1);
      expect(result.page.comments[0].author).toBe('alice');
      expect(result.page.total).toBe(42);
      expect(result.page.cursor).toBe('Y3Vyc29y');
      expect(result.page.hasMore).toBe(true);
    }
  });

  it('appends the before cursor to the query when paging older', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => rawPage }));

    await CommentApi.fetchPage('Ab3-xY9_q2', 'the-cursor');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/posts\/Ab3-xY9_q2\/comments\?before=the-cursor$/),
      expect.anything(),
    );
  });

  it('reports failure on a non-2xx response', async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    expect((await CommentApi.fetchPage('missing000')).ok).toBe(false);
  });

  it('reports failure when fetch rejects (offline)', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect((await CommentApi.fetchPage('Ab3-xY9_q2')).ok).toBe(false);
  });
});
