// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemeMedia from '../../src/components/MemeMedia';
import type { FeedMedia } from '../../src/lib/feedModel';

// jsdom has no IntersectionObserver; the video branch wires one up via useVideoAutoplay
// (US3), so every test in this file needs a stub even when it never fires it.
class StubIntersectionObserver {
  observe(): void {}

  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const imageMedia: FeedMedia = {
  kind: 'image',
  src: '/img/800/a/abc.jpg',
  srcset: '/img/800/a/abc.jpg 800w, /img/300/a/abc.jpg 300w',
  sizes: '(min-width: 80rem) 80rem, 100vw',
  alt: 'Funny cat',
  width: 800,
  height: 400,
};

const videoMedia: FeedMedia = {
  kind: 'video',
  src: '/img/800/a/abc.jpg',
  srcset: '',
  sizes: '(min-width: 80rem) 80rem, 100vw',
  alt: 'Funny clip',
  width: 800,
  height: 400,
  videoSrc: '/video/a/clip.mp4',
  mime: 'video/mp4',
};

describe('MemeMedia', () => {
  it('renders a lazy responsive img for image media', () => {
    render(<MemeMedia media={imageMedia} />);

    const img = screen.getByRole('img', { name: 'Funny cat' });
    expect(img.getAttribute('src')).toBe('/img/800/a/abc.jpg');
    expect(img.getAttribute('srcset')).toContain('300w');
    expect(img.getAttribute('sizes')).toContain('80rem');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('width')).toBe('800');
  });

  it('omits srcset and sizes when no variants exist', () => {
    render(<MemeMedia media={{ ...imageMedia, srcset: '' }} />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('srcset')).toBeNull();
    expect(img.getAttribute('sizes')).toBeNull();
  });

  it('renders no link when linkTo is omitted', () => {
    render(<MemeMedia media={imageMedia} />);

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('wraps the image in a permalink when linkTo is given', () => {
    render(<MemeMedia media={imageMedia} linkTo="/posts/abc1234567" />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
    expect(link.getAttribute('tabindex')).toBe('-1');
    expect(link.querySelector('img')).not.toBeNull();
  });

  it('drops the link together with a broken image', () => {
    render(<MemeMedia media={imageMedia} linkTo="/posts/abc1234567" />, { wrapper: MemoryRouter });

    fireEvent.error(screen.getByRole('img'));

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not wrap youtube media in a link', () => {
    render(
      <MemeMedia
        media={{ kind: 'youtube', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', title: 'Song' }}
        linkTo="/posts/abc1234567"
      />,
      { wrapper: MemoryRouter },
    );

    expect(screen.queryByRole('link')).toBeNull();
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

  it('renders a <video> with a poster and a single matching <source> for video media', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('poster')).toBe('/img/800/a/abc.jpg');
    const sources = video?.querySelectorAll('source');
    expect(sources).toHaveLength(1);
    expect(sources?.[0].getAttribute('src')).toBe('/video/a/clip.mp4');
    expect(sources?.[0].getAttribute('type')).toBe('video/mp4');
  });

  it('starts video playback muted', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);

    const video = container.querySelector('video');
    expect(video?.muted).toBe(true);
  });

  it('the unmute control toggles muted without pausing playback', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    expect(video.muted).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    // The label itself now names the opposite action, still keyboard-operable via the
    // same real <button> element (Principle IV).
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInstanceOf(HTMLButtonElement);
  });

  it('the pause control toggles playback', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);

    // jsdom starts `paused` true (matching the initial "Play" label); the control reads that
    // real flag, so it stays correct even when autoplay-on-scroll — not this button — is what
    // actually started playback. A mocked play()/pause() does not flip jsdom's internal
    // paused state or fire the browser's own play/pause events, so both are simulated here.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalled();

    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    fireEvent.play(video);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInstanceOf(HTMLButtonElement);

    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalled();

    // Symmetric to the play-direction sync above: the browser's own 'pause' event (not the
    // click) is what flips the label back, proving the onPause handler is wired too.
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInstanceOf(HTMLButtonElement);
  });

  it('exposes the unmute and pause controls as labeled, keyboard-operable buttons', () => {
    render(<MemeMedia media={videoMedia} />);

    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInstanceOf(HTMLButtonElement);
  });

  it('renders the mute and play controls as icon-only buttons with no visible text', () => {
    render(<MemeMedia media={videoMedia} />);

    const unmuteBtn = screen.getByRole('button', { name: 'Unmute' });
    const playBtn = screen.getByRole('button', { name: 'Play' });
    expect(unmuteBtn.textContent).toBe('');
    expect(playBtn.textContent).toBe('');
    expect(unmuteBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(playBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
