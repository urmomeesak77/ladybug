import { describe, expect, it } from 'vitest';

import { Youtube } from '../../src/lib/youtube';

const ID = 'dQw4w9WgXcQ';
const EMBED = `https://www.youtube-nocookie.com/embed/${ID}`;

describe('toEmbedUrl', () => {
  it('parses a standard watch URL', () => {
    expect(Youtube.toEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(EMBED);
  });

  it('parses a watch URL with extra query params', () => {
    expect(Youtube.toEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(EMBED);
  });

  it('parses a youtu.be short link', () => {
    expect(Youtube.toEmbedUrl(`https://youtu.be/${ID}`)).toBe(EMBED);
  });

  it('parses an already-embed URL', () => {
    expect(Youtube.toEmbedUrl(`https://www.youtube.com/embed/${ID}`)).toBe(EMBED);
  });

  it('parses a shorts URL', () => {
    expect(Youtube.toEmbedUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(EMBED);
  });

  it('parses a shorts URL on any host form, with or without query params', () => {
    expect(Youtube.toEmbedUrl(`https://m.youtube.com/shorts/${ID}`)).toBe(EMBED);
    expect(Youtube.toEmbedUrl(`https://youtube.com/shorts/${ID}?feature=share`)).toBe(EMBED);
  });

  it('accepts a bare 11-char video id', () => {
    expect(Youtube.toEmbedUrl(ID)).toBe(EMBED);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(Youtube.toEmbedUrl(null)).toBeNull();
    expect(Youtube.toEmbedUrl(undefined)).toBeNull();
    expect(Youtube.toEmbedUrl('')).toBeNull();
  });

  it('returns null for unparseable junk', () => {
    expect(Youtube.toEmbedUrl('not a video')).toBeNull();
    expect(Youtube.toEmbedUrl('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for an id of the wrong length', () => {
    expect(Youtube.toEmbedUrl('shortid')).toBeNull();
    expect(Youtube.toEmbedUrl('waytoolongvideoid123')).toBeNull();
  });
});

// The feed's click-to-play facade shows this still instead of mounting an iframe per post.
describe('toThumbnailUrl', () => {
  it('builds the fixed-form thumbnail URL from a parsed video id', () => {
    expect(Youtube.toThumbnailUrl(`https://youtu.be/${ID}`)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it('builds it for a bare id and a shorts link alike', () => {
    expect(Youtube.toThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(Youtube.toThumbnailUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it('returns null for missing or unparseable input', () => {
    expect(Youtube.toThumbnailUrl(null)).toBeNull();
    expect(Youtube.toThumbnailUrl('not a video')).toBeNull();
  });
});
