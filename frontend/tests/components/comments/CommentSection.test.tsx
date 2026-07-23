// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentSection from '../../../src/components/comments/CommentSection';
import { AuthContext } from '../../../src/hooks/useAuth';
import type { AuthContextValue } from '../../../src/hooks/useAuth';
import { CommentApi } from '../../../src/lib/commentApi';
import type { Comment, CommentPage } from '../../../src/lib/commentModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A guest AuthContext value — the section renders inside it; the composer gates on it (US2).
function guestAuth(): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    role: 'guest',
    register: async () => ({ ok: true, user: null as never }),
    login: async () => ({ ok: true, user: null as never }),
    logout: async () => {},
    refresh: async () => {},
  };
}

function renderSection(hash = 'Post000001') {
  render(
    <AuthContext.Provider value={guestAuth()}>
      <MemoryRouter>
        <CommentSection hash={hash} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function comment(hash: string, author: string): Comment {
  return { hash, body: `body ${hash}`, author, hidden: false, createdAt: null };
}

function page(overrides: Partial<CommentPage> = {}): CommentPage {
  return { comments: [], total: 0, cursor: null, hasMore: false, ...overrides };
}

describe('CommentSection', () => {
  it('shows the public comment count and the comments once loaded', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({
      ok: true,
      page: page({ comments: [comment('New0000001', 'alice'), comment('Old0000001', 'bob')], total: 2 }),
    });

    renderSection();

    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    expect(screen.getByText('2 comments')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('uses the singular label for a single comment', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({
      ok: true,
      page: page({ comments: [comment('New0000001', 'alice')], total: 1 }),
    });

    renderSection();

    await waitFor(() => expect(screen.getByText('1 comment')).toBeTruthy());
  });

  it('shows an explicit empty state for a post with no comments', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: page() });

    renderSection();

    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeTruthy());
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
