// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import MemeMedia from '../../src/components/MemeMedia';
import type { FeedMedia } from '../../src/lib/feedModel';

afterEach(cleanup);

const imageMedia: FeedMedia = {
  kind: 'image',
  src: '/img/800/a/abc.jpg',
  srcset: '/img/800/a/abc.jpg 800w, /img/300/a/abc.jpg 300w',
  sizes: '(min-width: 48rem) 48rem, 100vw',
  alt: 'Funny cat',
  width: 800,
  height: 400,
};

describe('MemeMedia', () => {
  it('renders a lazy responsive img for image media', () => {
    render(<MemeMedia media={imageMedia} />);

    const img = screen.getByRole('img', { name: 'Funny cat' });
    expect(img.getAttribute('src')).toBe('/img/800/a/abc.jpg');
    expect(img.getAttribute('srcset')).toContain('300w');
    expect(img.getAttribute('sizes')).toContain('48rem');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('width')).toBe('800');
  });

  it('omits srcset and sizes when no variants exist', () => {
    render(<MemeMedia media={{ ...imageMedia, srcset: '' }} />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('srcset')).toBeNull();
    expect(img.getAttribute('sizes')).toBeNull();
  });

  it('degrades to nothing when the image fails to load', () => {
    render(<MemeMedia media={imageMedia} />);

    fireEvent.error(screen.getByRole('img'));

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a sanitized iframe for youtube media', () => {
    render(
      <MemeMedia
        media={{ kind: 'youtube', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', title: 'Song' }}
      />,
    );

    const iframe = document.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframe?.getAttribute('title')).toBe('Song');
  });

  it('renders nothing for a post with no media', () => {
    const { container } = render(<MemeMedia media={{ kind: 'none' }} />);

    expect(container.innerHTML).toBe('');
  });
});
