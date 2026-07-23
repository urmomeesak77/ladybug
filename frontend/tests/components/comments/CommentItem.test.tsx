// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CommentItem from '../../../src/components/comments/CommentItem';
import type { Comment } from '../../../src/lib/commentModel';

afterEach(cleanup);

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    hash: 'Ab3-xY9_q2',
    body: 'first line\nsecond line',
    author: 'alice',
    hidden: false,
    createdAt: '2026-07-23T10:15:00.000000Z',
    ...overrides,
  };
}

function renderItem(overrides: Partial<Comment> = {}) {
  return render(<CommentItem comment={comment(overrides)} />);
}

describe('CommentItem', () => {
  it('shows the author name', () => {
    renderItem({ author: 'alice' });
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('falls back to Anonymous when there is no author', () => {
    renderItem({ author: null });
    expect(screen.getByText('Anonymous')).toBeTruthy();
  });

  it('renders the formatted post time', () => {
    renderItem({ createdAt: '2026-07-23T10:15:00.000000Z' });
    expect(screen.getByText(/Jul 23, 2026/)).toBeTruthy();
  });

  it('renders the body as literal plain text (never markup)', () => {
    renderItem({ body: '<script>alert(1)</script>' });
    // React escapes the child, so the tag is visible text, not an injected element.
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
});
