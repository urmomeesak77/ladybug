// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PostPage from '../../src/pages/PostPage';
import NoticeProvider from '../../src/components/NoticeProvider';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import { Api } from '../../src/lib/api';
import { ModerationApi } from '../../src/lib/moderationApi';
import type { RoleName } from '../../src/lib/role';
import type { FeedPost } from '../../src/lib/feedModel';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

// A minimal AuthContext value; PostPage reads only `role` to decide the admin kebab.
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
  hidden: null,
  author: 'alice',
  createdAt: '2026-07-22T12:00:00',
  commentCount: 0,
};

function renderPost(hash = 'abc1234567', role: RoleName = 'guest') {
  render(
    <AuthContext.Provider value={auth(role)}>
      <NoticeProvider>
        <MemoryRouter initialEntries={[`/posts/${hash}`]}>
          <Routes>
            <Route path="/posts/:hash" element={<PostPage />} />
            <Route path="/" element={<h1>Home</h1>} />
          </Routes>
        </MemoryRouter>
      </NoticeProvider>
    </AuthContext.Provider>,
  );
}

describe('PostPage', () => {
  it('renders the loaded meme with its media and titles the tab after it', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();

    expect(await screen.findByRole('heading', { name: 'Funny cat' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Funny cat' })).toBeTruthy();
    // The title is set in an effect keyed on the fetch state; await it rather than racing
    // the effect flush (flaked under coverage-instrumented load).
    await waitFor(() => expect(document.title).toBe('Funny cat - online-trash'));
  });

  it('shows a hidden banner when the loaded post is not publicly visible', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, hidden: 'pending' } });

    renderPost();

    expect(await screen.findByRole('heading', { name: 'Funny cat' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/pending review/i);
  });

  it('shows no hidden banner for a public post', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, hidden: null } });

    renderPost();

    await screen.findByRole('heading', { name: 'Funny cat' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('falls back to a generic heading for an untitled meme', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, title: null } });

    renderPost();

    expect(await screen.findByRole('heading', { name: 'Untitled meme' })).toBeTruthy();
    // Same effect race as above: the previous test's title lingers until the effect runs.
    await waitFor(() => expect(document.title).toBe('online-trash'));
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

  it('shows the uploader byline on the loaded meme', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();

    expect(await screen.findByText(/by alice/i)).toBeTruthy();
    expect(screen.getByText(/2026-07-22/)).toBeTruthy();
  });

  it('shows no admin actions for an anonymous viewer', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();
    await screen.findByRole('heading', { name: 'Funny cat' });

    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('lets an admin deactivate, flipping the post to the pending banner', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: {
        hash: 'abc1234567', thumbnail: null, title: null, type: null,
        username: null, createdAt: null, activatedAt: null, deletedAt: null,
      },
    });

    renderPost('abc1234567', 'admin');
    await screen.findByRole('heading', { name: 'Funny cat' });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/pending review/i));
  });

  it('navigates home after an admin permanently deletes the post', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, hidden: 'deleted' } });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });

    renderPost('abc1234567', 'admin');
    await screen.findByRole('heading', { name: 'Funny cat' });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy());
  });
});
