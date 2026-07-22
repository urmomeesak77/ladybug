import { describe, expect, it } from 'vitest';

import { FeedModel } from '../../src/lib/feedModel';
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
      { url: 'https://cdn.example/x/large.jpg', width: 800 },
    ],
    original: 'https://cdn.example/x/original.jpg',
    metadata: '{"width":1280,"height":720}',
    url: '/posts/abc1234567',
    hidden: null,
    ...overrides,
  };
}

describe('mapPost', () => {
  it('builds the permalink from the opaque hash', () => {
    expect(FeedModel.mapPost(makeRaw()).permalink).toBe('/posts/abc1234567');
  });

  it('passes a pending hidden status through to the post', () => {
    expect(FeedModel.mapPost(makeRaw({ hidden: 'pending' })).hidden).toBe('pending');
  });

  it('passes a deleted hidden status through to the post', () => {
    expect(FeedModel.mapPost(makeRaw({ hidden: 'deleted' })).hidden).toBe('deleted');
  });

  it('defaults hidden to null when the field is absent', () => {
    expect(FeedModel.mapPost(makeRaw()).hidden).toBeNull();
  });

  it('prefers a parseable youtube ref over any image (media precedence)', () => {
    const post = FeedModel.mapPost(makeRaw({ youtube: 'https://youtu.be/dQw4w9WgXcQ' }));

    expect(post.media.kind).toBe('youtube');
    if (post.media.kind === 'youtube') {
      expect(post.media.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      expect(post.media.title.length).toBeGreaterThan(0);
    }
  });

  it('falls back to an image when youtube is absent or unparseable', () => {
    const post = FeedModel.mapPost(makeRaw({ youtube: 'not a video' }));

    expect(post.media.kind).toBe('image');
  });

  it('assembles srcset widest-first with the original as the widest candidate', () => {
    const post = FeedModel.mapPost(makeRaw());

    if (post.media.kind === 'image') {
      expect(post.media.src).toBe('https://cdn.example/x/default.jpg');
      expect(post.media.srcset).toBe(
        'https://cdn.example/x/original.jpg 1280w, ' +
          'https://cdn.example/x/large.jpg 800w, ' +
          'https://cdn.example/x/small.jpg 320w',
      );
    } else {
      throw new Error('expected image media');
    }
  });

  it('serves the original alone in srcset when no numeric sizes exist', () => {
    const post = FeedModel.mapPost(makeRaw({ sizes: [] }));

    if (post.media.kind === 'image') {
      expect(post.media.srcset).toBe('https://cdn.example/x/original.jpg 1280w');
    }
  });

  it('omits srcset when there is neither a numeric size nor an original width', () => {
    const post = FeedModel.mapPost(makeRaw({ sizes: [], metadata: null }));

    if (post.media.kind === 'image') {
      expect(post.media.srcset).toBe('');
    }
  });

  it('uses the title as alt text, with a non-empty fallback when title is null', () => {
    const titled = FeedModel.mapPost(makeRaw({ title: 'Cat on a roomba' }));
    const untitled = FeedModel.mapPost(makeRaw({ title: null }));

    if (titled.media.kind === 'image') {
      expect(titled.media.alt).toBe('Cat on a roomba');
    }
    if (untitled.media.kind === 'image') {
      expect(untitled.media.alt.length).toBeGreaterThan(0);
    }
  });

  it('yields kind "none" when there is no youtube and no image source', () => {
    const post = FeedModel.mapPost(
      makeRaw({ youtube: null, default: null, sizes: [], original: null }),
    );

    expect(post.media.kind).toBe('none');
  });

  it('reserves image dimensions parsed from metadata', () => {
    const post = FeedModel.mapPost(makeRaw({ metadata: '{"width":640,"height":480}' }));

    if (post.media.kind === 'image') {
      expect(post.media.width).toBe(640);
      expect(post.media.height).toBe(480);
    } else {
      throw new Error('expected image media');
    }
  });

  it('leaves image dimensions undefined when metadata is missing', () => {
    const post = FeedModel.mapPost(makeRaw({ metadata: null }));

    if (post.media.kind === 'image') {
      expect(post.media.width).toBeUndefined();
      expect(post.media.height).toBeUndefined();
    } else {
      throw new Error('expected image media');
    }
  });
});

describe('pickImageSource', () => {
  it('prefers default, then widest size, then original — never fabricating a URL', () => {
    expect(FeedModel.pickImageSource(makeRaw())).toBe('https://cdn.example/x/default.jpg');
    expect(FeedModel.pickImageSource(makeRaw({ default: null }))).toBe('https://cdn.example/x/large.jpg');
    expect(FeedModel.pickImageSource(makeRaw({ default: null, sizes: [] }))).toBe(
      'https://cdn.example/x/original.jpg',
    );
    expect(FeedModel.pickImageSource(makeRaw({ default: null, sizes: [], original: null }))).toBeNull();
  });
});

describe('parseDimensions', () => {
  it('extracts positive width and height from metadata JSON', () => {
    expect(FeedModel.parseDimensions('{"width":800,"height":600}')).toEqual({ width: 800, height: 600 });
  });

  it('returns null for missing, malformed, or non-positive dimensions', () => {
    expect(FeedModel.parseDimensions(null)).toBeNull();
    expect(FeedModel.parseDimensions('not json')).toBeNull();
    expect(FeedModel.parseDimensions('{"width":0,"height":600}')).toBeNull();
    expect(FeedModel.parseDimensions('{"format":"landscape"}')).toBeNull();
  });
});
