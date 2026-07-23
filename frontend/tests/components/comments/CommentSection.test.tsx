// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentSection from '../../../src/components/comments/CommentSection';
import { CommentApi } from '../../../src/lib/commentApi';
import type { Comment, CommentPage } from '../../../src/lib/commentModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

    render(<CommentSection hash="Post000001" />);

    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    expect(screen.getByText('2 comments')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('uses the singular label for a single comment', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({
      ok: true,
      page: page({ comments: [comment('New0000001', 'alice')], total: 1 }),
    });

    render(<CommentSection hash="Post000001" />);

    await waitFor(() => expect(screen.getByText('1 comment')).toBeTruthy());
  });

  it('shows an explicit empty state for a post with no comments', async () => {
    vi.spyOn(CommentApi, 'fetchPage').mockResolvedValue({ ok: true, page: page() });

    render(<CommentSection hash="Post000001" />);

    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeTruthy());
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
