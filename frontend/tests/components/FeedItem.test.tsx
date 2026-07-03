// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import FeedItem from '../../src/components/FeedItem';
import type { FeedPost } from '../../src/lib/feedModel';

afterEach(cleanup);

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    hash: 'abc1234567',
    title: 'Funny cat',
    permalink: '/posts/abc1234567',
    media: { kind: 'none' },
    ...overrides,
  };
}

describe('FeedItem', () => {
  it('links the title to the post permalink', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('falls back to a generic title for untitled posts', () => {
    render(<FeedItem post={post({ title: null })} />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Untitled meme' })).toBeTruthy();
  });
});
