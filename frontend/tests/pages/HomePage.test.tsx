// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(3, 'b') });

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

    // The initial mount is a POP navigation: it hydrates the snapshot without fetching.
    expect(await screen.findByText('Post a0000000')).toBeTruthy();
    expect(fetchFeed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    // The link navigation remounts the feed fresh: old posts gone, page 1 refetched,
    // viewport back at the top.
    expect(await screen.findByText('Post b0000000')).toBeTruthy();
    expect(screen.queryByText('Post a0000000')).toBeNull();
    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
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
