// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CommentCount from '../../src/components/CommentCount';

afterEach(cleanup);

describe('CommentCount', () => {
  it('shows the number and a pluralized label for many comments', () => {
    render(<CommentCount count={12} />);

    const badge = screen.getByLabelText('12 comments');
    expect(badge.textContent).toContain('12');
  });

  it('uses the singular label for exactly one comment', () => {
    render(<CommentCount count={1} />);

    expect(screen.getByLabelText('1 comment')).toBeTruthy();
  });

  it('shows zero with the plural label when there are no comments', () => {
    render(<CommentCount count={0} />);

    const badge = screen.getByLabelText('0 comments');
    expect(badge.textContent).toContain('0');
  });

  it('marks the icon decorative so only the label is announced', () => {
    const { container } = render(<CommentCount count={3} />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
