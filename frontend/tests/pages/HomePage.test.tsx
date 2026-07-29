// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from '../../src/pages/HomePage';
import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { Api } from '../../src/lib/api';
import type { RoleName } from '../../src/lib/role';
import type { FeedPost } from '../../src/lib/feedModel';

// A minimal AuthContext value; HomePage reads only `role` to decide the admin kebab.
function auth(role: RoleName): AuthContextValue {
  return {
    status: role === 'guest' ? 'anonymous' : 'authenticated',
    user: role === 'guest' ? null : {
      hash: 'u000000001', name: 'Admin', email: 'a@example.test',
      emailVerifiedAt: null, role, createdAt: '', updatedAt: '',
    },
    role,
    register: async () => ({ ok: true, user: null as never }),
    login: async () => ({ ok: true, user: null as never }),
    logout: async () => {},
    refresh: async () => {},
  };
}

function post(hash: string): FeedPost {
  return {
    hash,
    title: `Post ${hash}`,
    permalink: `/posts/${hash}`,
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
    commentCount: 0,
  };
}

function posts(count: number, prefix: string): FeedPost[] {
  const list: FeedPost[] = [];
  for (let i = 0; i < count; i++) {
    list.push(post(`${prefix}${String(i).padStart(7, '0')}`));
  }
  return list;
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHome(path = '/', role: RoleName = 'guest') {
  render(
    <AuthContext.Provider value={auth(role)}>
      <NoticeProvider>
        <MemoryRouter initialEntries={[path]}>
          <HomePage />
        </MemoryRouter>
      </NoticeProvider>
    </AuthContext.Provider>,
  );
}

describe('HomePage', () => {
  it('renders the labeled memes section with the newest feed', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome();

    expect(screen.getByRole('region', { name: 'Memes' })).toBeTruthy();
    expect(await screen.findByText(/no memes yet/i)).toBeTruthy();
    expect(Api.fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  });

  it('sets the document title', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome();
    await screen.findByText(/no memes yet/i);

    expect(document.title).toBe('online-trash');
  });

  it('feeds the URL page cursor into the feed request', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome('/?after=cursor0001');
    await screen.findByText(/no memes yet/i);

    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: 'cursor0001' });
  });

  it('resets to a fresh top-of-feed when a link navigates home again', async () => {
    // A previous visit with 3 posts loaded. anchorHash stays null: a saved anchor would
    // send the initial restore through CSS.escape, which jsdom lacks (anchor-ignoring
    // when fresh is unit-tested in useScrollRestoration.test.tsx).
    sessionStorage.setItem('ladybug.feed:/', JSON.stringify({
      posts: posts(3, 'a'),
      cursor: 'a0000002',
      status: 'end',
      anchorHash: null,
      anchorOffset: 0,
    }));
    const fetchFeed = vi.spyOn(Api, 'fetchFeed')
      // Background revalidation on the POP mount returns the same head, so nothing is dropped.
      .mockResolvedValueOnce({ ok: true, posts: posts(3, 'a') })
      // The later fresh (link) navigation reloads page 1 with different posts.
      .mockResolvedValue({ ok: true, posts: posts(3, 'b') });

    render(
      <AuthContext.Provider value={auth('guest')}>
        <NoticeProvider>
          <MemoryRouter initialEntries={['/']}>
            <Link to="/">Home</Link>
            <HomePage />
          </MemoryRouter>
        </NoticeProvider>
      </AuthContext.Provider>,
    );

    // The initial mount is a POP navigation: it hydrates the snapshot synchronously and
    // fires a single background revalidation (no page re-walk, and here nothing drops).
    expect(await screen.findByText('Post a0000000')).toBeTruthy();
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith({ limit: 10 }));

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    // The link navigation remounts the feed fresh: old posts gone, page 1 refetched,
    // viewport back at the top.
    expect(await screen.findByText('Post b0000000')).toBeTruthy();
    expect(screen.queryByText('Post a0000000')).toBeNull();
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('carries exactly one top-level heading naming the feed', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [post('a0000000')] });

    renderHome();
    await screen.findByText('Post a0000000');

    const top = screen.getAllByRole('heading', { level: 1 });
    expect(top).toHaveLength(1);
    expect(top[0].textContent).toMatch(/memes/i);
  });

  it('keeps feed entry titles one level below the page heading', async () => {
    vi.spyOn(Api, 'fetchFeed')
      .mockResolvedValue({ ok: true, posts: [post('a0000000'), post('a0000001')] });

    renderHome();
    await screen.findByText('Post a0000001');

    // Levels in DOM order must start at 1 and never jump by more than one, or a
    // screen reader's heading outline gains a hole where a level was skipped.
    const levels = screen.getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['Post a0000000', 'Post a0000001']);
  });

  it('shows the admin actions kebab on feed items for an admin', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [post('a0000000')] });

    renderHome('/', 'admin');

    expect(await screen.findByRole('button', { name: /more actions for post a0000000/i })).toBeTruthy();
  });

  it('shows no admin actions for an anonymous viewer', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [post('a0000000')] });

    renderHome();

    expect(await screen.findByText('Post a0000000')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });
});
