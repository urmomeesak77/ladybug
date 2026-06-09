import { toEmbedUrl } from './youtube';

// The raw post shape from the 004 feed API. Only the fields the mainpage renders are
// listed; everything else in the response is ignored.
export type RawPost = {
  hash: string;
  title: string | null;
  youtube: string | null;
  default: string | null;
  sizes: ImageSize[] | null;
  original: string | null;
  url: string;
};

export type ImageSize = { url: string; width: number };

export type FeedMediaKind = 'image' | 'youtube' | 'none';

export type FeedMedia =
  | { kind: 'image'; src: string; srcset: string; sizes: string; alt: string }
  | { kind: 'youtube'; embedUrl: string; title: string }
  | { kind: 'none' };

export type FeedPost = {
  hash: string;
  title: string | null;
  permalink: string;
  media: FeedMedia;
};

// Non-empty alt/title fallback so screen-reader users are never given a blank image
// (Principle IV / FR-012).
const GENERIC_ALT = 'Meme image';

// The <img sizes> hint: the feed column is capped at the layout max width, full-bleed below.
const IMAGE_SIZES = '(min-width: 48rem) 48rem, 100vw';

// Pick the image src by precedence: API `default`, else the widest declared size, else
// `original`. Returns null when the post has no image at all. Never fabricates a URL —
// only values present in the response are used (Principle VI).
export function pickImageSource(raw: RawPost): string | null {
  if (raw.default) {
    return raw.default;
  }
  const widest = widestSize(raw.sizes);
  if (widest) {
    return widest.url;
  }
  return raw.original ?? null;
}

function widestSize(sizes: ImageSize[] | null): ImageSize | null {
  if (!sizes || sizes.length === 0) {
    return null;
  }
  return [...sizes].sort((a, b) => b.width - a.width)[0];
}

function buildSrcset(sizes: ImageSize[] | null): string {
  if (!sizes || sizes.length === 0) {
    return '';
  }
  return [...sizes]
    .sort((a, b) => b.width - a.width)
    .map((size) => `${size.url} ${size.width}w`)
    .join(', ');
}

function deriveMedia(raw: RawPost): FeedMedia {
  const embedUrl = toEmbedUrl(raw.youtube);
  if (embedUrl) {
    return { kind: 'youtube', embedUrl, title: raw.title ?? GENERIC_ALT };
  }
  const src = pickImageSource(raw);
  if (src) {
    return {
      kind: 'image',
      src,
      srcset: buildSrcset(raw.sizes),
      sizes: IMAGE_SIZES,
      alt: raw.title ?? GENERIC_ALT,
    };
  }
  return { kind: 'none' };
}

export function mapPost(raw: RawPost): FeedPost {
  return {
    hash: raw.hash,
    title: raw.title,
    permalink: `/posts/${raw.hash}`,
    media: deriveMedia(raw),
  };
}
