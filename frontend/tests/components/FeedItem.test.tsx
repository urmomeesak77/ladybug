// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FeedItem from '../../src/components/FeedItem';
import NoticeProvider from '../../src/components/NoticeProvider';
import { ModerationApi } from '../../src/lib/moderationApi';
import type { FeedPost } from '../../src/lib/feedModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    hash: 'abc1234567',
    title: 'Funny cat',
    permalink: '/posts/abc1234567',
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
    ...overrides,
  };
}

describe('FeedItem', () => {
  it('links the title to the post permalink', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('links the image to the post permalink as well', () => {
    const media = {
      kind: 'image' as const,
      src: '/img/800/a/abc.jpg',
      srcset: '',
      sizes: '',
      alt: 'Funny cat pic',
      width: 800,
      height: 400,
    };
    render(<FeedItem post={post({ media })} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat pic' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('falls back to a generic title for untitled posts', () => {
    render(<FeedItem post={post({ title: null })} />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Untitled meme' })).toBeTruthy();
  });

  it('shows the uploader byline below the media', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    expect(screen.getByText(/by alice/i)).toBeTruthy();
    expect(screen.getByText(/Jul 22, 2026/)).toBeTruthy();
  });

  it('shows no admin actions by default', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('shows the admin actions kebab when canModerate', () => {
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={() => {}} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    expect(screen.getByRole('button', { name: /more actions for funny cat/i })).toBeTruthy();
  });

  it('removes the item after a successful deactivate', async () => {
    const onRemove = vi.fn();
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: {
        hash: 'abc1234567', thumbnail: null, title: null, type: null,
        username: null, createdAt: null, activatedAt: null, deletedAt: null,
      },
    });
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={onRemove} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('abc1234567'));
  });

  it('keeps the item when an action leaves the meme public', async () => {
    const onRemove = vi.fn();
    // Defensive: if an action returns a still-public row (hidden null), the feed keeps it —
    // dropping it would hide a meme that is still visible to everyone.
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: {
        hash: 'abc1234567', thumbnail: null, title: null, type: null,
        username: null, createdAt: null, activatedAt: '2026-07-09 08:00:00', deletedAt: null,
      },
    });
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={onRemove} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(ModerationApi.deactivate).toHaveBeenCalled());
    expect(onRemove).not.toHaveBeenCalled();
  });
});
