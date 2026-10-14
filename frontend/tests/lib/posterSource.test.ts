import { describe, expect, it } from 'vitest';

import { PosterSource } from '../../src/lib/posterSource';

const SRCSET = '/p/1200.jpg 1200w, /p/800.jpg 800w, /p/500.jpg 500w, /p/300.jpg 300w';

describe('PosterSource.pick', () => {
  it('picks the narrowest variant that still covers the target width', () => {
    expect(PosterSource.pick(SRCSET, '/p/800.jpg', 360)).toBe('/p/500.jpg');
    expect(PosterSource.pick(SRCSET, '/p/800.jpg', 500)).toBe('/p/500.jpg');
  });

  // The default (800) variant is what the poster used before; a wide or dense screen must
  // never be handed something heavier than that for a poster most visitors never see long.
  it('never goes wider than the default poster width', () => {
    expect(PosterSource.pick(SRCSET, '/p/800.jpg', 2400)).toBe('/p/800.jpg');
  });

  // A small upload has no 800 variant: its src is the widest downscale, and the original —
  // also in the srcset — is wider than that. The poster must not grow past the old src.
  it('never goes wider than the fallback src when the srcset lists it', () => {
    const smallUpload = '/p/orig.jpg 700w, /p/500.jpg 500w, /p/300.jpg 300w';
    expect(PosterSource.pick(smallUpload, '/p/500.jpg', 600)).toBe('/p/500.jpg');
    expect(PosterSource.pick(smallUpload, '/p/500.jpg', 250)).toBe('/p/300.jpg');
  });

  it('falls back to the given src when no variant covers the target', () => {
    expect(PosterSource.pick('/p/300.jpg 300w', '/p/fallback.jpg', 640)).toBe('/p/fallback.jpg');
  });

  it('falls back to the given src for an empty or malformed srcset', () => {
    expect(PosterSource.pick('', '/p/fallback.jpg', 360)).toBe('/p/fallback.jpg');
    expect(PosterSource.pick('garbage, /x.jpg', '/p/fallback.jpg', 360)).toBe('/p/fallback.jpg');
  });
});

describe('PosterSource.targetWidth', () => {
  it('is the viewport width in device pixels', () => {
    expect(PosterSource.targetWidth({ innerWidth: 400, devicePixelRatio: 2 })).toBe(800);
  });

  it('treats a missing device pixel ratio as 1', () => {
    expect(PosterSource.targetWidth({ innerWidth: 400, devicePixelRatio: 0 })).toBe(400);
  });
});
