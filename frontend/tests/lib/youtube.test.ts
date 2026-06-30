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
