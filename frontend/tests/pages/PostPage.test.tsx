// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PostPage from '../../src/pages/PostPage';
import { Api } from '../../src/lib/api';
import type { FeedPost } from '../../src/lib/feedModel';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post: FeedPost = {
  hash: 'abc1234567',
  title: 'Funny cat',
  permalink: '/posts/abc1234567',
  media: {
    kind: 'image',
    src: '/img/800/a/abc.jpg',
    srcset: '',
    sizes: '',
    alt: 'Funny cat',
  },
};

function renderPost(hash = 'abc1234567') {
  render(
    <MemoryRouter initialEntries={[`/posts/${hash}`]}>
      <Routes>
        <Route path="/posts/:hash" element={<PostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PostPage', () => {
  it('renders the loaded meme with its media and titles the tab after it', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();

    expect(await screen.findByRole('heading', { name: 'Funny cat' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Funny cat' })).toBeTruthy();
    expect(document.title).toBe('Funny cat - online-trash');
  });

  it('falls back to a generic heading for an untitled meme', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, title: null } });

    renderPost();

    expect(await screen.findByRole('heading', { name: 'Untitled meme' })).toBeTruthy();
    expect(document.title).toBe('online-trash');
  });

  it('shows the not-found view for an unknown hash', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({
      ok: false,
      error: { kind: 'notFound', status: 404 },
    });

    renderPost('missing000');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('offers an in-place retry after a retryable failure', async () => {
    vi.spyOn(Api, 'fetchPost')
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } })
      .mockResolvedValueOnce({ ok: true, post });

    renderPost();
    await screen.findByText(/something went wrong/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Funny cat' })).toBeTruthy();
  });

  it('resets the scroll position before paint', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();
    await screen.findByRole('heading', { name: 'Funny cat' });

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
