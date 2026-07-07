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

  it('links the image to the post permalink as well', () => {
    const media = {
      kind: 'image' as const,
      src: '/img/800/a/abc.jpg',
      srcset: '',
      sizes: '',
      alt: 'Funny cat pic',
      width: 800,
      height: 400,
    };
    render(<FeedItem post={post({ media })} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat pic' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('falls back to a generic title for untitled posts', () => {
    render(<FeedItem post={post({ title: null })} />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Untitled meme' })).toBeTruthy();
  });
});
