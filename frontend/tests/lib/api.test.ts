import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildFeedUrl, fetchFeed } from '../../src/lib/api';

describe('buildFeedUrl', () => {
  it('defaults limit to 10 and omits start when absent', () => {
    const url = buildFeedUrl({});

    expect(url).toMatch(/\/api\/posts\?limit=10$/);
    expect(url).not.toContain('start=');
  });

  it('clamps limit into [1, 50]', () => {
    expect(buildFeedUrl({ limit: 999 })).toContain('limit=50');
    expect(buildFeedUrl({ limit: 0 })).toContain('limit=1');
    expect(buildFeedUrl({ limit: -7 })).toContain('limit=1');
    expect(buildFeedUrl({ limit: 25 })).toContain('limit=25');
  });

  it('URL-encodes the start cursor', () => {
    const url = buildFeedUrl({ start: 'a/b c' });

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

  function stubFetch(impl: () => Promise<unknown>): void {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('maps the data array into FeedPosts on success', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { hash: 'abc1234567', title: 'Hi', youtube: null, default: null, sizes: [], original: null, url: '/posts/abc1234567' },
        ],
      }),
    }));

    const result = await fetchFeed({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].hash).toBe('abc1234567');
    }
  });

  it('classifies a non-2xx response as an http error carrying the status', async () => {
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const result = await fetchFeed({});

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

    const result = await fetchFeed({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }
  });
});
