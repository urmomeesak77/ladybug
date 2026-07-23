// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentItem from '../../../src/components/comments/CommentItem';
import type { Comment } from '../../../src/lib/commentModel';
import type { RoleName } from '../../../src/lib/role';

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

function renderAsAdmin(
  overrides: Partial<Comment> = {},
  handlers: { onHide?: (h: string) => void; onUnhide?: (h: string) => void; onDelete?: (h: string) => void } = {},
  role: RoleName = 'admin',
) {
  return render(
    <CommentItem
      comment={comment(overrides)}
      viewerRole={role}
      onHide={handlers.onHide ?? vi.fn()}
      onUnhide={handlers.onUnhide ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
    />,
  );
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

describe('CommentItem admin controls', () => {
  it('shows no action menu for a guest or member', () => {
    render(<CommentItem comment={comment()} viewerRole="member" onHide={vi.fn()} onUnhide={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Hide in the menu for a visible comment as an admin', () => {
    renderAsAdmin({ hidden: false });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /^hide$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^unhide$/i })).toBeNull();
  });

  it('offers Unhide and shows a Hidden badge for a hidden comment as an admin', () => {
    renderAsAdmin({ hidden: true });
    // The hidden state is marked by text, not colour alone (Principle IV, FR-011).
    expect(screen.getByText(/hidden/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /^unhide$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^hide$/i })).toBeNull();
  });

  it('calls onHide with the comment hash when Hide is chosen', () => {
    const onHide = vi.fn();
    renderAsAdmin({ hidden: false }, { onHide });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^hide$/i }));
    expect(onHide).toHaveBeenCalledWith('Ab3-xY9_q2');
  });

  it('calls onUnhide with the comment hash when Unhide is chosen', () => {
    const onUnhide = vi.fn();
    renderAsAdmin({ hidden: true }, { onUnhide });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^unhide$/i }));
    expect(onUnhide).toHaveBeenCalledWith('Ab3-xY9_q2');
  });
});
