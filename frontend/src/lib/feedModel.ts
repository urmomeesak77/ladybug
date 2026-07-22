import { Youtube } from './youtube';

// The raw post shape from the 004 feed API. Only the fields the mainpage renders are
// listed; everything else in the response is ignored.
export type RawPost = {
  hash: string;
  title: string | null;
  youtube: string | null;
  default: string | null;
  sizes: ImageSize[] | null;
  original: string | null;
  metadata: string | null;
  url: string;
  hidden: 'pending' | 'deleted' | null;
};

export type ImageSize = { url: string; width: number };

export type ImageDimensions = { width: number; height: number };

export type FeedMediaKind = 'image' | 'youtube' | 'none';

export type FeedMedia =
  | { kind: 'image'; src: string; srcset: string; sizes: string; alt: string; width?: number; height?: number }
  | { kind: 'youtube'; embedUrl: string; title: string }
  | { kind: 'none' };

export type FeedPost = {
  hash: string;
  title: string | null;
  permalink: string;
  media: FeedMedia;
  hidden: 'pending' | 'deleted' | null;
};

// Non-empty alt/title fallback so screen-reader users are never given a blank image
// (Principle IV / FR-012).
const GENERIC_ALT = 'Meme image';

// The <img sizes> hint: the feed column is capped at the layout max width, full-bleed below.
const IMAGE_SIZES = '(min-width: 80rem) 80rem, 100vw';

// Maps a raw API post into the render-ready FeedPost the feed/post views consume.
export class FeedModel {
  // Parse intrinsic image dimensions from the post's metadata JSON so the <img> can reserve
  // its box before loading. Reserving height keeps the feed layout (and thus a restored
  // scroll position) stable as lazy images load. Returns null when absent/malformed.
  static parseDimensions(metadata: string | null): ImageDimensions | null {
    if (!metadata) {
      return null;
    }
    try {
      const parsed = JSON.parse(metadata) as { width?: unknown; height?: unknown };
      const width = Number(parsed.width);
      const height = Number(parsed.height);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Pick the image src by precedence: API `default`, else the widest declared size, else
  // `original`. Returns null when the post has no image at all. Never fabricates a URL —
  // only values present in the response are used (Principle VI).
  static pickImageSource(raw: RawPost): string | null {
    if (raw.default) {
      return raw.default;
    }
    const widest = FeedModel.widestSize(raw.sizes);
    if (widest) {
      return widest.url;
    }
    return raw.original ?? null;
  }

  static mapPost(raw: RawPost): FeedPost {
    return {
      hash: raw.hash,
      title: raw.title,
      permalink: `/posts/${raw.hash}`,
      media: FeedModel.deriveMedia(raw),
      hidden: raw.hidden ?? null,
    };
  }

  private static widestSize(sizes: ImageSize[] | null): ImageSize | null {
    if (!sizes || sizes.length === 0) {
      return null;
    }
    return [...sizes].sort((a, b) => b.width - a.width)[0];
  }

  private static buildSrcset(sizes: ImageSize[] | null): string {
    if (!sizes || sizes.length === 0) {
      return '';
    }
    return [...sizes]
      .sort((a, b) => b.width - a.width)
      .map((size) => `${size.url} ${size.width}w`)
      .join(', ');
  }

  private static deriveMedia(raw: RawPost): FeedMedia {
    const embedUrl = Youtube.toEmbedUrl(raw.youtube);
    if (embedUrl) {
      return { kind: 'youtube', embedUrl, title: raw.title ?? GENERIC_ALT };
    }
    const src = FeedModel.pickImageSource(raw);
    if (src) {
      const dimensions = FeedModel.parseDimensions(raw.metadata);
      return {
        kind: 'image',
        src,
        srcset: FeedModel.buildSrcset(raw.sizes),
        sizes: IMAGE_SIZES,
        alt: raw.title ?? GENERIC_ALT,
        width: dimensions?.width,
        height: dimensions?.height,
      };
    }
    return { kind: 'none' };
  }
}
