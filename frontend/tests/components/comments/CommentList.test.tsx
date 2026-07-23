// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentList from '../../../src/components/comments/CommentList';
import type { Comment } from '../../../src/lib/commentModel';

afterEach(cleanup);

function comment(hash: string, author: string): Comment {
  return { hash, body: `body ${hash}`, author, hidden: false, createdAt: null };
}

const comments = [comment('New0000001', 'alice'), comment('Old0000001', 'bob')];

function renderList(props: Partial<Parameters<typeof CommentList>[0]> = {}) {
  const onLoadMore = props.onLoadMore ?? vi.fn();
  render(
    <CommentList
      comments={comments}
      hasMore={false}
      loadingMore={false}
      onLoadMore={onLoadMore}
      {...props}
    />,
  );
  return { onLoadMore };
}

describe('CommentList', () => {
  it('renders one item per comment newest-first in order', () => {
    renderList();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('alice');
    expect(items[1].textContent).toContain('bob');
  });

  it('shows the "load more older comments" control when there is more', () => {
    renderList({ hasMore: true });
    expect(screen.getByRole('button', { name: /load more older comments/i })).toBeTruthy();
  });

  it('hides the load-more control when there is no more', () => {
    renderList({ hasMore: false });
    expect(screen.queryByRole('button', { name: /load more older comments/i })).toBeNull();
  });

  it('calls onLoadMore when the control is clicked', () => {
    const { onLoadMore } = renderList({ hasMore: true });
    fireEvent.click(screen.getByRole('button', { name: /load more older comments/i }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
