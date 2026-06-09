import { describe, expect, it } from 'vitest';

import { mapPost, pickImageSource } from '../../src/lib/feedModel';
import type { RawPost } from '../../src/lib/feedModel';

// A fully-populated raw post; individual tests null out fields to exercise precedence.
function makeRaw(overrides: Partial<RawPost> = {}): RawPost {
  return {
    hash: 'abc1234567',
    title: 'A funny meme',
    youtube: null,
    default: 'https://cdn.example/x/default.jpg',
    sizes: [
      { url: 'https://cdn.example/x/small.jpg', width: 320 },
      { url: 'https://cdn.example/x/large.jpg', width: 1280 },
    ],
    original: 'https://cdn.example/x/original.jpg',
    url: '/posts/abc1234567',
    ...overrides,
  };
}

describe('mapPost', () => {
  it('builds the permalink from the opaque hash', () => {
    expect(mapPost(makeRaw()).permalink).toBe('/posts/abc1234567');
  });

  it('prefers a parseable youtube ref over any image (media precedence)', () => {
    const post = mapPost(makeRaw({ youtube: 'https://youtu.be/dQw4w9WgXcQ' }));

    expect(post.media.kind).toBe('youtube');
    if (post.media.kind === 'youtube') {
      expect(post.media.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      expect(post.media.title.length).toBeGreaterThan(0);
    }
  });

  it('falls back to an image when youtube is absent or unparseable', () => {
    const post = mapPost(makeRaw({ youtube: 'not a video' }));

    expect(post.media.kind).toBe('image');
  });

  it('assembles srcset widest-first from sizes', () => {
    const post = mapPost(makeRaw());

    if (post.media.kind === 'image') {
      expect(post.media.src).toBe('https://cdn.example/x/default.jpg');
      expect(post.media.srcset).toBe(
        'https://cdn.example/x/large.jpg 1280w, https://cdn.example/x/small.jpg 320w',
      );
    } else {
      throw new Error('expected image media');
    }
  });

  it('uses the title as alt text, with a non-empty fallback when title is null', () => {
    const titled = mapPost(makeRaw({ title: 'Cat on a roomba' }));
    const untitled = mapPost(makeRaw({ title: null }));

    if (titled.media.kind === 'image') {
      expect(titled.media.alt).toBe('Cat on a roomba');
    }
    if (untitled.media.kind === 'image') {
      expect(untitled.media.alt.length).toBeGreaterThan(0);
    }
  });

  it('omits srcset when there are no sizes', () => {
    const post = mapPost(makeRaw({ sizes: [] }));

    if (post.media.kind === 'image') {
      expect(post.media.srcset).toBe('');
    }
  });

  it('yields kind "none" when there is no youtube and no image source', () => {
    const post = mapPost(
      makeRaw({ youtube: null, default: null, sizes: [], original: null }),
    );

    expect(post.media.kind).toBe('none');
  });
});

describe('pickImageSource', () => {
  it('prefers default, then widest size, then original — never fabricating a URL', () => {
    expect(pickImageSource(makeRaw())).toBe('https://cdn.example/x/default.jpg');
    expect(pickImageSource(makeRaw({ default: null }))).toBe('https://cdn.example/x/large.jpg');
    expect(pickImageSource(makeRaw({ default: null, sizes: [] }))).toBe(
      'https://cdn.example/x/original.jpg',
    );
    expect(pickImageSource(makeRaw({ default: null, sizes: [], original: null }))).toBeNull();
  });
});
