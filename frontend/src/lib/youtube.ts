// Parse a post's free-form `youtube` field into a single known-good embed URL, or null.
// Principle VI: never embed raw user input — we extract only a valid 11-char video id
// and rebuild a fixed-form URL ourselves. The privacy-friendly nocookie host is used.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Host-specific id locations across the common share/watch/embed forms.
const URL_PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})/, // watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be/ID
  /\/embed\/([A-Za-z0-9_-]{11})/, // /embed/ID
  /\/shorts\/([A-Za-z0-9_-]{11})/, // /shorts/ID
];

export class Youtube {
  static toEmbedUrl(raw: string | null | undefined): string | null {
    if (!raw) {
      return null;
    }
    const id = Youtube.extractId(raw.trim());
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  // The still the feed shows in place of a live player until the visitor asks for one (a
  // feed page can hold up to 200 posts; an iframe per YouTube post would boot a whole
  // player each). Rebuilt from the parsed id like the embed URL, never the raw input;
  // hqdefault is the size YouTube generates for every video, so it never 404s.
  static toThumbnailUrl(raw: string | null | undefined): string | null {
    if (!raw) {
      return null;
    }
    const id = Youtube.extractId(raw.trim());
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  }

  private static extractId(raw: string): string | null {
    if (VIDEO_ID.test(raw)) {
      return raw;
    }
    for (const pattern of URL_PATTERNS) {
      const match = raw.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }
}
