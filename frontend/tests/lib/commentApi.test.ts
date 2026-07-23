// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('CommentApi.create', () => {
  // Csrf.ensure() short-circuits on an existing cookie; set one so no priming fetch is added.
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=test-token';
  });

  afterEach(() => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  const created = {
    hash: 'Zk8_La2-p0',
    body: 'Nice meme!',
    username: 'alice',
    hidden: false,
    created_at: '2026-07-23T11:02:00.000000Z',
  };

  it('POSTs the body with the CSRF header and maps the created comment on 201', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 201, json: async () => ({ data: created }) }));

    const result = await CommentApi.create('Post000001', 'Nice meme!');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/posts\/Post000001\/comments$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': expect.anything(), 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body: 'Nice meme!' }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comment.hash).toBe('Zk8_La2-p0');
      expect(result.comment.author).toBe('alice');
    }
  });

  it('reports validation errors on a 422', async () => {
    stubFetch(async () => ({ ok: false, status: 422, json: async () => ({ errors: { body: ['The body field is required.'] } }) }));

    const result = await CommentApi.create('Post000001', '');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('validation');
      if (result.kind === 'validation') {
        expect(result.errors.body).toContain('The body field is required.');
      }
    }
  });

  it('maps 401 to auth, 403 to unverified, 404 to notFound, 429 to rateLimited', async () => {
    for (const [status, kind] of [[401, 'auth'], [403, 'unverified'], [404, 'notFound'], [429, 'rateLimited']] as const) {
      stubFetch(async () => ({ ok: false, status, json: async () => ({}) }));
      const result = await CommentApi.create('Post000001', 'hi');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe(kind);
      }
    }
  });

  it('reports network on a rejected fetch', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await CommentApi.create('Post000001', 'hi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
    }
  });
});
