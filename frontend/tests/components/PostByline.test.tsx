// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PostByline from '../../src/components/PostByline';

afterEach(cleanup);

describe('PostByline', () => {
  it('renders the author and the formatted date', () => {
    render(<PostByline author="alice" createdAt="2026-07-22T12:00:00Z" />);

    expect(screen.getByText(/by alice/i).textContent).toContain('by alice');
    expect(screen.getByText(/Jul 22, 2026/)).toBeTruthy();
  });

  it('falls back to Anonymous when there is no author', () => {
    render(<PostByline author={null} createdAt="2026-07-22T12:00:00Z" />);

    expect(screen.getByText(/by Anonymous/i)).toBeTruthy();
  });

  it('omits the date and separator when the date is unavailable', () => {
    render(<PostByline author="alice" createdAt={null} />);

    const byline = screen.getByText(/by alice/i);
    expect(byline.textContent).toBe('by alice');
  });
});
