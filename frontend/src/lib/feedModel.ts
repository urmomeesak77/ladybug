import { Youtube } from './youtube';

// The raw post shape from the 004 feed API. Only the fields the mainpage renders are
// listed; everything else in the response is ignored.
export type RawPost = {
  hash: string;
  title: string | null;
  youtube: string | null;
  youtube_is_short: boolean;
  video: string | null;
  default: string | null;
  sizes: ImageSize[] | null;
  original: string | null;
  metadata: string | null;
  url: string;
  hidden: 'pending' | 'deleted' | null;
  username: string | null;
  created_at: string | null;
  comment_count: number;
};

export type ImageSize = { url: string; width: number };

export type ImageDimensions = { width: number; height: number };

export type FeedMediaKind = 'image' | 'video' | 'youtube' | 'none';

export type FeedMedia =
  | { kind: 'image'; src: string; srcset: string; sizes: string; alt: string; width?: number; height?: number }
  | {
      kind: 'video';
      src: string;
      srcset: string;
      sizes: string;
      alt: string;
      width?: number;
      height?: number;
      videoSrc: string;
      mime: string;
    }
  | { kind: 'youtube'; embedUrl: string; title: string; isShort: boolean }
  | { kind: 'none' };

export type FeedPost = {
  hash: string;
  title: string | null;
  permalink: string;
  media: FeedMedia;
  hidden: 'pending' | 'deleted' | null;
  author: string | null;
  createdAt: string | null;
  commentCount: number;
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
      author: raw.username,
      createdAt: raw.created_at,
      commentCount: raw.comment_count ?? 0,
    };
  }

  private static widestSize(sizes: ImageSize[] | null): ImageSize | null {
    if (!sizes || sizes.length === 0) {
      return null;
    }
    return [...sizes].sort((a, b) => b.width - a.width)[0];
  }

  private static buildSrcset(
    sizes: ImageSize[] | null,
    original: string | null,
    originalWidth: number | null,
  ): string {
    const candidates: ImageSize[] = sizes ? [...sizes] : [];
    // The original is the widest candidate so the browser never has to upscale a variant
    // to fill a slot wider than 1200px (it picks the original there instead).
    if (original && originalWidth && originalWidth > 0) {
      candidates.push({ url: original, width: originalWidth });
    }
    if (candidates.length === 0) {
      return '';
    }
    return candidates
      .sort((a, b) => b.width - a.width)
      .map((size) => `${size.url} ${size.width}w`)
      .join(', ');
  }

  // Video src → MIME sniff, from the URL's extension alone (no server round trip). Anything
  // that is not a recognized .webm is served as video/mp4 — the only other extension the
  // backend ever writes (TrashpostVideoProcessor::extensionFor), never a transcode.
  private static videoMime(videoSrc: string): string {
    return videoSrc.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
  }

  private static deriveMedia(raw: RawPost): FeedMedia {
    if (raw.video) {
      const posterSrc = FeedModel.pickImageSource(raw);
      if (posterSrc) {
        const dimensions = FeedModel.parseDimensions(raw.metadata);
        return {
          kind: 'video',
          src: posterSrc,
          srcset: FeedModel.buildSrcset(raw.sizes, raw.original, dimensions?.width ?? null),
          sizes: IMAGE_SIZES,
          alt: raw.title ?? GENERIC_ALT,
          width: dimensions?.width,
          height: dimensions?.height,
          videoSrc: raw.video,
          mime: FeedModel.videoMime(raw.video),
        };
      }
    }
    const embedUrl = Youtube.toEmbedUrl(raw.youtube);
    if (embedUrl) {
      // `?? false` covers a response that predates the field, which must render wide
      // rather than in an undefined-driven half state (same guard as `comment_count`).
      return {
        kind: 'youtube',
        embedUrl,
        title: raw.title ?? GENERIC_ALT,
        isShort: raw.youtube_is_short ?? false,
      };
    }
    const src = FeedModel.pickImageSource(raw);
    if (src) {
      const dimensions = FeedModel.parseDimensions(raw.metadata);
      return {
        kind: 'image',
        src,
        srcset: FeedModel.buildSrcset(raw.sizes, raw.original, dimensions?.width ?? null),
        sizes: IMAGE_SIZES,
        alt: raw.title ?? GENERIC_ALT,
        width: dimensions?.width,
        height: dimensions?.height,
      };
    }
    return { kind: 'none' };
  }
}
