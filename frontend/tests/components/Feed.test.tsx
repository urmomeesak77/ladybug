// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Feed from '../../src/components/Feed';
import { Api } from '../../src/lib/api';
import type { FeedPost } from '../../src/lib/feedModel';

// jsdom has no IntersectionObserver; capture instances so tests can drive the sentinel.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {}

  intersect(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function post(hash: string): FeedPost {
  return { hash, title: `Post ${hash}`, permalink: `/posts/${hash}`, media: { kind: 'none' }, hidden: null };
}

function posts(count: number, prefix: string): FeedPost[] {
  const list: FeedPost[] = [];
  for (let i = 0; i < count; i++) {
    list.push(post(`${prefix}${String(i).padStart(7, '0')}`));
  }
  return list;
}

function renderFeed(after?: string) {
  render(
    <MemoryRouter initialEntries={[after ? `/?after=${after}` : '/']}>
      <Feed after={after} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  // jsdom does not implement scrolling; the scroll-restoration hook calls it on mount.
  vi.stubGlobal('scrollTo', vi.fn());
  MockIntersectionObserver.instances = [];
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Feed', () => {
  it('loads and renders the first batch', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'a') });

    renderFeed();

    expect(await screen.findByText('Post a0000000')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(Api.fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  });

  it('passes the URL page cursor as the first batch start', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderFeed('cursor0001');

    await screen.findByText(/no memes yet/i);
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: 'cursor0001' });
  });

  it('shows the empty state when the first batch is empty', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderFeed();

    expect(await screen.findByText(/no memes yet/i)).toBeTruthy();
  });

  it('marks the end of the feed after a short batch', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(3, 'a') });

    renderFeed();

    expect(await screen.findByText(/reached the end/i)).toBeTruthy();
  });

  it('appends the next batch when the sentinel becomes visible', async () => {
    const fetchFeed = vi
      .spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'a') })
      .mockResolvedValueOnce({ ok: true, posts: posts(10, 'b') });

    renderFeed();
    await screen.findByText('Post a0000000');
    // The observer is attached in a passive effect; wait for it before intersecting.
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0));

    act(() => MockIntersectionObserver.instances[0].intersect());

    expect(await screen.findByText('Post b0000000')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    // The second batch starts after the last post of the first (keyset cursor).
    expect(fetchFeed).toHaveBeenLastCalledWith({ limit: 10, start: 'a0000009' });
  });

  it('keeps loaded posts and offers a retry when a batch fails', async () => {
    vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, posts: posts(3, 'a') });

    renderFeed();
    await screen.findByText(/something went wrong/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Post a0000000')).toBeTruthy();
  });

  // Rendering a 200-post page is heavy; under full-suite parallel load the default 5s
  // timeout is occasionally exceeded even though the test itself is fast in isolation.
  it('stops auto-loading at the 200-entry page break and links the next page', { timeout: 15000 }, async () => {
    // Hydrate a full page from the snapshot so the break is reached without 20 fetches.
    const fullPage = posts(200, 'a');
    sessionStorage.setItem('ladybug.feed:/', JSON.stringify({
      posts: fullPage,
      cursor: fullPage[fullPage.length - 1].hash,
      status: 'loaded',
      anchorHash: null,
      anchorOffset: 0,
    }));
    const fetchFeed = vi.spyOn(Api, 'fetchFeed');

    renderFeed();

    const loadMore = await screen.findByRole('link', { name: 'Load more' });
    expect(loadMore.getAttribute('href')).toBe('/?after=a0000199');
    // At the page break there is no sentinel and no auto-fetch.
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });
});
