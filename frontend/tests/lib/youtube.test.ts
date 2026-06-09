import { describe, expect, it } from 'vitest';

import { toEmbedUrl } from '../../src/lib/youtube';

const ID = 'dQw4w9WgXcQ';
const EMBED = `https://www.youtube-nocookie.com/embed/${ID}`;

describe('toEmbedUrl', () => {
  it('parses a standard watch URL', () => {
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(EMBED);
  });

  it('parses a watch URL with extra query params', () => {
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(EMBED);
  });

  it('parses a youtu.be short link', () => {
    expect(toEmbedUrl(`https://youtu.be/${ID}`)).toBe(EMBED);
  });

  it('parses an already-embed URL', () => {
    expect(toEmbedUrl(`https://www.youtube.com/embed/${ID}`)).toBe(EMBED);
  });

  it('accepts a bare 11-char video id', () => {
    expect(toEmbedUrl(ID)).toBe(EMBED);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(toEmbedUrl(null)).toBeNull();
    expect(toEmbedUrl(undefined)).toBeNull();
    expect(toEmbedUrl('')).toBeNull();
  });

  it('returns null for unparseable junk', () => {
    expect(toEmbedUrl('not a video')).toBeNull();
    expect(toEmbedUrl('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for an id of the wrong length', () => {
    expect(toEmbedUrl('shortid')).toBeNull();
    expect(toEmbedUrl('waytoolongvideoid123')).toBeNull();
  });
});
