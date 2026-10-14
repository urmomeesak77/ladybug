// The widest poster a video post is given when its src's own width is unknown: the
// backend's 800px `default` variant, which is what `media.src` normally is. Choosing from
// the srcset may only go narrower — a poster is usually on screen for a moment, so it is
// not worth more bytes than before.
const MAX_POSTER_WIDTH = 800;

// One `url 123w` candidate of a srcset string.
const CANDIDATE = /^(\S+)\s+(\d+)w$/;

type Candidate = { url: string; width: number };

// `<video poster>` has no srcset of its own, so the responsive choice the browser makes for
// an <img> is made here instead: on a narrow screen a 500px variant serves just as well.
export class PosterSource {
  static targetWidth(view: { innerWidth: number; devicePixelRatio: number }): number {
    return view.innerWidth * (view.devicePixelRatio || 1);
  }

  // The narrowest candidate at least as wide as the target, never wider than `fallback` —
  // the post's own src — when the srcset says how wide that is (else MAX_POSTER_WIDTH).
  // Nothing suitable means `fallback`, so a missing or odd srcset changes nothing.
  static pick(srcset: string, fallback: string, targetWidth: number): string {
    const candidates = PosterSource.parse(srcset);
    const limit = candidates.find((candidate) => candidate.url === fallback)?.width ?? MAX_POSTER_WIDTH;
    const target = Math.min(targetWidth, limit);
    const covering = candidates
      .filter((candidate) => candidate.width >= target && candidate.width <= limit)
      .sort((a, b) => a.width - b.width);
    return covering.length > 0 ? covering[0].url : fallback;
  }

  private static parse(srcset: string): Candidate[] {
    const candidates: Candidate[] = [];
    for (const part of srcset.split(',')) {
      const match = part.trim().match(CANDIDATE);
      if (match) {
        candidates.push({ url: match[1], width: Number(match[2]) });
      }
    }
    return candidates;
  }
}
