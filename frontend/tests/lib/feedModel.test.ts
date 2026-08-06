import { describe, expect, it } from 'vitest';

import { FeedModel } from '../../src/lib/feedModel';
import type { RawPost } from '../../src/lib/feedModel';

// A fully-populated raw post; individual tests null out fields to exercise precedence.
function makeRaw(overrides: Partial<RawPost> = {}): RawPost {
  return {
    hash: 'abc1234567',
    title: 'A funny meme',
    youtube: null,
    youtube_is_short: false,
    video: null,
    default: 'https://cdn.example/x/default.jpg',
    sizes: [
      { url: 'https://cdn.example/x/small.jpg', width: 320 },
      { url: 'https://cdn.example/x/large.jpg', width: 800 },
    ],
    original: 'https://cdn.example/x/original.jpg',
    metadata: '{"width":1280,"height":720}',
    url: '/posts/abc1234567',
    hidden: null,
    username: 'alice',
    created_at: '2026-07-22T14:30:00Z',
    comment_count: 5,
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

  it('maps a shorts post to youtube media flagged as a short', () => {
    const post = FeedModel.mapPost(
      makeRaw({ youtube: 'dQw4w9WgXcQ', youtube_is_short: true }),
    );

    expect(post.media.kind).toBe('youtube');
    if (post.media.kind === 'youtube') {
      expect(post.media.isShort).toBe(true);
    }
  });

  it('maps a regular youtube post as not a short', () => {
    const post = FeedModel.mapPost(makeRaw({ youtube: 'dQw4w9WgXcQ' }));

    expect(post.media.kind).toBe('youtube');
    if (post.media.kind === 'youtube') {
      expect(post.media.isShort).toBe(false);
    }
  });

  it('treats an absent youtube_is_short field as not a short', () => {
    // A response from a backend that predates the field must not yield `undefined`.
    const raw = makeRaw({ youtube: 'dQw4w9WgXcQ' });
    delete (raw as Partial<RawPost>).youtube_is_short;

    const post = FeedModel.mapPost(raw);

    expect(post.media.kind).toBe('youtube');
    if (post.media.kind === 'youtube') {
      expect(post.media.isShort).toBe(false);
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

  it('derives a video variant with the same poster fields an equivalent image post would have', () => {
    const withVideo = FeedModel.mapPost(
      makeRaw({ video: 'https://cdn.example/x/clip.mp4' }),
    );
    const withoutVideo = FeedModel.mapPost(makeRaw({ video: null }));

    expect(withVideo.media.kind).toBe('video');
    if (withVideo.media.kind === 'video' && withoutVideo.media.kind === 'image') {
      expect(withVideo.media.src).toBe(withoutVideo.media.src);
      expect(withVideo.media.srcset).toBe(withoutVideo.media.srcset);
      expect(withVideo.media.sizes).toBe(withoutVideo.media.sizes);
      expect(withVideo.media.alt).toBe(withoutVideo.media.alt);
      expect(withVideo.media.width).toBe(withoutVideo.media.width);
      expect(withVideo.media.height).toBe(withoutVideo.media.height);
      expect(withVideo.media.videoSrc).toBe('https://cdn.example/x/clip.mp4');
    } else {
      throw new Error('expected video and image media');
    }
  });

  it('checks raw.video before youtube/image, per research.md item 8', () => {
    const post = FeedModel.mapPost(
      makeRaw({ video: 'https://cdn.example/x/clip.mp4', youtube: 'https://youtu.be/dQw4w9WgXcQ' }),
    );

    expect(post.media.kind).toBe('video');
  });

  it('derives mime video/mp4 for a .mp4 url and video/webm for a .webm url', () => {
    const mp4 = FeedModel.mapPost(makeRaw({ video: 'https://cdn.example/x/clip.mp4' }));
    const webm = FeedModel.mapPost(makeRaw({ video: 'https://cdn.example/x/clip.webm' }));

    if (mp4.media.kind === 'video' && webm.media.kind === 'video') {
      expect(mp4.media.mime).toBe('video/mp4');
      expect(webm.media.mime).toBe('video/webm');
    } else {
      throw new Error('expected video media');
    }
  });

  it('falls back to kind "none" when video is set but no poster source can be derived', () => {
    const post = FeedModel.mapPost(
      makeRaw({
        video: 'https://cdn.example/x/clip.mp4',
        youtube: null,
        default: null,
        sizes: [],
        original: null,
      }),
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

describe('mapPost author and date', () => {
  it('carries the resolved author name through', () => {
    expect(FeedModel.mapPost(makeRaw({ username: 'alice' })).author).toBe('alice');
  });

  it('carries the created_at timestamp through as createdAt', () => {
    expect(FeedModel.mapPost(makeRaw({ created_at: '2026-07-22T14:30:00Z' })).createdAt).toBe(
      '2026-07-22T14:30:00Z',
    );
  });

  it('passes a null author and date through unchanged', () => {
    const post = FeedModel.mapPost(makeRaw({ username: null, created_at: null }));

    expect(post.author).toBeNull();
    expect(post.createdAt).toBeNull();
  });

  it('maps the comment count, defaulting to zero when absent', () => {
    expect(FeedModel.mapPost(makeRaw({ comment_count: 7 })).commentCount).toBe(7);
    expect(FeedModel.mapPost(makeRaw({ comment_count: undefined as unknown as number })).commentCount).toBe(0);
  });
});
