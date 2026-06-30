import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../../src/lib/api';

function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('buildFeedUrl', () => {
  it('defaults limit to 10 and omits start when absent', () => {
    const url = Api.buildFeedUrl({});

    expect(url).toMatch(/\/api\/posts\?limit=10$/);
    expect(url).not.toContain('start=');
  });

  it('clamps limit into [1, 50]', () => {
    expect(Api.buildFeedUrl({ limit: 999 })).toContain('limit=50');
    expect(Api.buildFeedUrl({ limit: 0 })).toContain('limit=1');
    expect(Api.buildFeedUrl({ limit: -7 })).toContain('limit=1');
    expect(Api.buildFeedUrl({ limit: 25 })).toContain('limit=25');
  });

  it('URL-encodes the start cursor', () => {
    const url = Api.buildFeedUrl({ start: 'a/b c' });

    // Reserved characters are percent-encoded rather than passed raw (a space may encode
    // as "+" or "%20" — both decode to a space; what matters is it is never literal).
    expect(url).toContain('start=a%2Fb');
    expect(url).not.toMatch(/start=a\/b c/);
    expect(url).toContain('limit=10');
  });
});

describe('fetchFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the data array into FeedPosts on success', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            hash: 'abc1234567',
            title: 'Hi',
            youtube: null,
            default: null,
            sizes: [],
            original: null,
            url: '/posts/abc1234567',
          },
        ],
      }),
    }));

    const result = await Api.fetchFeed({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].hash).toBe('abc1234567');
    }
  });

  it('classifies a non-2xx response as an http error carrying the status', async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const result = await Api.fetchFeed({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.status).toBe(503);
    }
  });

  it('classifies a thrown fetch (offline) as a network error', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await Api.fetchFeed({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }
  });
});

describe('buildPostUrl', () => {
  it('builds the single-post path from the hash', () => {
    expect(Api.buildPostUrl('abc1234567')).toMatch(/\/api\/posts\/abc1234567$/);
  });

  it('path-encodes the raw hash rather than passing it verbatim', () => {
    // The hash is opaque client-side; a malformed value must not break the URL path.
    const url = Api.buildPostUrl('a/b?c#d');

    expect(url).toMatch(/\/api\/posts\/a%2Fb%3Fc%23d$/);
  });
});

describe('fetchPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const rawPost = {
    hash: 'abc1234567',
    title: 'Hi',
    youtube: null,
    default: '/storage/abc/default.jpg',
    sizes: [{ url: '/storage/abc/w320.jpg', width: 320 }],
    original: null,
    metadata: null,
    url: '/posts/abc1234567',
  };

  it('maps a 200 body through mapPost into a loaded post', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: rawPost }) }));

    const result = await Api.fetchPost('abc1234567');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.post.hash).toBe('abc1234567');
      expect(result.post.title).toBe('Hi');
      expect(result.post.permalink).toBe('/posts/abc1234567');
      expect(result.post.media.kind).toBe('image');
    }
  });

  it('requests the post URL with the JSON Accept header', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: rawPost }) }));
    vi.stubGlobal('fetch', fetchMock);

    await Api.fetchPost('abc1234567');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/posts\/abc1234567$/),
      { headers: { Accept: 'application/json' } },
    );
  });

  it('classifies a 404 as notFound carrying the status', async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    const result = await Api.fetchPost('AAAAAAAAAA');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('notFound');
      expect(result.error.status).toBe(404);
    }
  });

  it('classifies any other non-2xx as an http error carrying the status', async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const result = await Api.fetchPost('abc1234567');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.status).toBe(503);
    }
  });

  it('classifies a thrown fetch (offline) as a network error', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await Api.fetchPost('abc1234567');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }
  });

  it('treats an unparseable 200 body as a network-level failure, not a crash', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));

    const result = await Api.fetchPost('abc1234567');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }
  });

  it('treats a 200 body without a data object as a retryable http error', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    const result = await Api.fetchPost('abc1234567');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.status).toBe(200);
    }
  });
});
