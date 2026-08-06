// Whether a post is animated is discovered in the browser, never from a stored flag or an
// API field (FR-016): the bytes the <img> already downloaded are handed to the platform's
// WebCodecs ImageDecoder, which reports the track facts authoritatively for both GIF and
// WebP (research R3). That is also why memes published before this feature need no
// backfill — nothing about them has to change (FR-007).

export type ProbeResult = {
  decoder: ImageDecoder;
  frameCount: number;
  repetitionCount: number;
};

// A frame duration under 20 ms is the legacy "as fast as possible" GIF encoding; every
// browser renders those at 100 ms natively, so a taken-over GIF must too or it would
// visibly outrun the same file on the fallback path (research R6).
const MIN_FRAME_DELAY_MS = 20;
const DEFAULT_FRAME_DELAY_MS = 100;

export class AnimatedImage {
  // The FR-012 gate. Everything downstream is skipped where this is false — notably all of
  // Safari/iOS today — leaving the plain <img> that animates exactly as it does now.
  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.ImageDecoder !== 'undefined';
  }

  // Cheap pre-filter so a JPEG/PNG feed never enters the path at all (FR-008): only these
  // two formats can carry an animation, and only the URL is needed to rule the rest out.
  static isCandidate(url: string): boolean {
    const path = url.split(/[?#]/)[0].toLowerCase();
    return path.endsWith('.gif') || path.endsWith('.webp');
  }

  // Resolves the animation facts, or null for "leave the <img> alone" — which covers an
  // unsupported browser, a non-candidate URL, a non-image response, a still image and any
  // thrown error alike (FR-012). Never throws.
  static async probe(url: string): Promise<ProbeResult | null> {
    if (!AnimatedImage.isSupported() || !AnimatedImage.isCandidate(url)) {
      return null;
    }
    try {
      // force-cache: the <img> has already downloaded these bytes, so this reads the HTTP
      // cache instead of pulling the file a second time (research R4).
      const response = await fetch(url, { cache: 'force-cache' });
      const type = AnimatedImage.decodableType(response);
      if (!type || !(await ImageDecoder.isTypeSupported(type))) {
        return null;
      }
      const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
      return await AnimatedImage.trackFacts(decoder);
    } catch {
      return null;
    }
  }

  // VideoFrame durations are microseconds; a missing or nonsensical one falls back to the
  // browsers' own default rather than spinning the canvas as fast as the timer allows.
  static frameDelayMs(durationMicroseconds: number | null): number {
    const delay = (durationMicroseconds ?? 0) / 1000;
    if (!Number.isFinite(delay) || delay < MIN_FRAME_DELAY_MS) {
      return DEFAULT_FRAME_DELAY_MS;
    }
    return delay;
  }

  private static decodableType(response: Response): string | null {
    if (!response.ok) {
      return null;
    }
    const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    return type === 'image/gif' || type === 'image/webp' ? type : null;
  }

  private static async trackFacts(decoder: ImageDecoder): Promise<ProbeResult | null> {
    await decoder.tracks.ready;
    // frameCount only settles once every byte is buffered, so a decoder read before this
    // resolves can report a partial animation as a still image.
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount <= 1) {
      decoder.close();
      return null;
    }
    return {
      decoder,
      frameCount: track.frameCount,
      repetitionCount: track.repetitionCount,
    };
  }
}
