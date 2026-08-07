# Contract: Animated-Image Playback (frontend-internal)

**Feature**: `021-gif-viewport-autoplay` | **Date**: 2026-08-06

## HTTP / API contract: unchanged

This feature adds, removes and changes **nothing** on the JSON API (FR-014, FR-016):

- `GET /api/posts` and `GET /api/posts/{hash}` return the same fields as today; no
  `is_animated`, no `frame_count`, no anything.
- No new endpoint, no new query parameter, no new header.
- No public media URL changes; the same variant files are served from `/storage/…`.
- The only new network traffic is a **same-origin `GET` of a media URL the browser has
  already fetched for the `<img>`**, issued with `cache: 'force-cache'` and only for
  `.gif`/`.webp` posts (research R4). No new backend route is involved.

The contracts that *do* change are internal frontend module boundaries, specified below
so `tasks.md` can be written against them.

---

## `lib/animatedImage.ts` — class `AnimatedImage` (static)

```ts
type ProbeResult = { decoder: ImageDecoder; frameCount: number; repetitionCount: number };

class AnimatedImage {
  /** True when this environment can decode images frame by frame (FR-012 gate). */
  static isSupported(): boolean;

  /** Cheap pre-filter: only .gif/.webp URLs are worth fetching (FR-008 stays free). */
  static isCandidate(url: string): boolean;

  /**
   * Fetch the bytes, build a decoder, and report the animation facts.
   * Resolves null for: unsupported env, non-candidate URL, non-image response,
   * single-frame file, or ANY thrown error — every one of which means "leave the
   * <img> alone" (FR-012).
   */
  static probe(url: string): Promise<ProbeResult | null>;

  /** VideoFrame duration (µs) → ms, with the legacy-GIF <20ms ⇒ 100ms clamp (R6). */
  static frameDelayMs(durationMicroseconds: number | null): number;
}
```

**Guarantees**: never throws; never returns a decoder for a still image; never fetches for
a non-candidate URL.

---

## `lib/animationRegistry.ts` — class `AnimationRegistry` (static)

```ts
class AnimationRegistry {
  /** Live-or-create the session for this URL, deduping concurrent calls; touches LRU. */
  static acquire(url: string): Promise<PlaybackSession | null>;

  /** Protect a session from eviction while its player is running (R9). */
  static pin(url: string): void;
  static unpin(url: string): void;

  /** Currently-held session without creating one (null when evicted/absent). */
  static peek(url: string): PlaybackSession | null;

  /** Remembered position; a URL never seen before reads as frame 0, 0 loops, unfinished. */
  static position(url: string): FramePosition;
  static savePosition(url: string, position: FramePosition): void;

  /** Test-only: closes every live decoder and clears both maps. */
  static reset(): void;
}
```

**Guarantees**:

1. `sessions.size ≤ 12` after any call (FR-017) — pinning never raises the cap.
2. `acquire` for an evicted URL rebuilds the session and **does not** touch its
   `FramePosition` (FR-018/FR-019).
3. Eviction closes the evicted decoder exactly once.
4. Two overlapping `acquire(url)` calls produce one decoder, not two.
5. `position` is pure — reading never allocates a session.
6. Eviction picks the least-recently-used **unpinned** session, so a session whose player
   is running is never closed while anything unpinned remains (R9). With every session
   pinned, guarantee 1 wins and the LRU is evicted regardless — the affected player's next
   decode rejects and re-acquires under `AnimationPlayer` guarantee 5.

---

## `lib/animationPlayer.ts` — class `AnimationPlayer` (instance)

```ts
class AnimationPlayer {
  constructor(url: string, canvas: HTMLCanvasElement);
  start(): void;   // resumes from the remembered frame; no-op when already running or finished
  stop(): void;    // freezes on the current frame and persists the position; no-op when stopped
  get isPlaying(): boolean;
}
```

**Guarantees**:

1. `start()` after `stop()` resumes at the frame `stop()` froze on — over any number of
   cycles, with no drift (FR-003, SC-004).
2. While stopped, no timer is scheduled and no frame is decoded — off-screen posts cost
   nothing and cannot consume a play-through (FR-002, FR-003a).
3. A finite `repetitionCount` yields exactly `repetitionCount + 1` play-throughs, ending
   on the final frame with `isFinished` persisted (FR-003a).
4. Every decoded `VideoFrame` is `close()`d after being drawn (R10).
5. A decode that rejects (e.g. its decoder was evicted mid-flight) triggers one
   re-acquire; a second failure stops the player on its current frame — never a blank
   canvas.
6. `stop()` is idempotent and safe to call from React cleanup.
7. `start()` pins its URL in the registry and `stop()` unpins it, so a running player's
   session cannot be evicted out from under it while any unpinned session exists (R9).

---

## `hooks/useInViewport.ts`

```ts
function useInViewport(node: Element | null): { isVisible: boolean; isNear: boolean };
```

- `isVisible` — FR-011: `isIntersecting && (ratio ≥ 0.5 || visibleHeight ≥ viewportHeight/2)`.
  Test (a) uses the same `0.5` constant as `useVideoAutoplay`, so normally sized media
  **starts** at the same scroll position as video (FR-004). It does not **stop** there:
  `useVideoAutoplay` branches on `isIntersecting` alone, which stays true below the
  threshold, so video pauses only on full exit. This hook evaluates the ratio itself and
  freezes at the boundary — the documented asymmetry (FR-004, research R5), not a bug to
  be reconciled.
- Both observers are created **only** when the hook is given a non-`null` node. Callers
  that have already ruled the post out (`!AnimatedImage.isSupported()` or
  `!AnimatedImage.isCandidate(src)`) pass `null` and pay for **zero** observers
  (FR-008/SC-007, FR-012/SC-009, research R5).
- `isNear` — the acquisition margin: intersecting a root expanded by one viewport
  (`rootMargin: '100% 0px'`).
- Both observers are disconnected on unmount and re-created when `node` changes (the
  `<img>` → `<canvas>` swap).
- **Does not touch `useVideoAutoplay`** — video's rule is unchanged (FR-004a, SC-010).

---

## `hooks/useAnimatedImage.ts`

```ts
function useAnimatedImage(src: string): {
  setNode: (node: HTMLElement | null) => void;   // callback ref for BOTH <img> and <canvas>
  takeover: { width: number; height: number } | null;
  isPlaying: boolean;                            // for the data-playing attribute
};
```

`src` is the post's `media.src` and is used **only** for the cheap `isCandidate()` filter.
The URL that is fetched, decoded and used as the registry key is the one the element
actually selected — `(node as HTMLImageElement).currentSrc` — because feed images carry a
real `srcset` whose chosen candidate is usually *not* `media.src` (research R4). Probing
`media.src` would download bytes the visitor never sees and size the canvas from the wrong
variant.

Behavior contract:

| Condition | Result |
|---|---|
| `AnimatedImage.isSupported()` is false | `takeover` stays `null` forever; zero fetches; **zero IntersectionObservers**; the `<img>` animates as today (FR-012, SC-009) |
| Not a `.gif`/`.webp` `src` | same — no fetch, no observers at all (FR-008, SC-007, R5) |
| Candidate, but the `<img>` has not selected a source yet (`currentSrc === ''`) | do not probe; re-check on the `<img>`'s `load` event and on the next `isNear` change (R4 deferred probe) |
| Candidate, `isNear` true **and** `currentSrc` non-empty | probe that URL once; on a still image, mark static and never retry |
| Probe succeeds | decode frame 0 (or the remembered frame), then set `takeover`; the canvas is drawn in a layout effect before paint (SC-008) |
| `isVisible` true **and** `!document.hidden` | player `start()` |
| `isVisible` false, **or** the page becomes hidden | player `stop()` (position persisted) — FR-002/FR-002a, research R16 |
| page becomes visible again while still `isVisible` | player `start()` on the held frame — no restart, no consumed play-through (SC-012) |
| unmount | player `stop()`, observers disconnected, `visibilitychange` listener removed; the session stays cached for Back (R9) |

---

## DOM contract (what the rest of the app and the tests may rely on)

Before takeover — **byte-for-byte today's markup**:

```html
<img class="meme-media meme-media__image" src srcset sizes alt width height loading="lazy">
```

After takeover:

```html
<canvas class="meme-media meme-media__image meme-media__canvas"
        role="img" aria-label="<same alt text>"
        width="<frame width>" height="<frame height>"
        style="--meme-media-width: <media.width>px"
        data-playing="true|false"></canvas>
```

- `role="img"` + `aria-label` preserve the text alternative a `<canvas>` otherwise lacks
  (Principle IV, FR-010).
- `data-playing` is the only new attribute; it is invisible, adds no control or overlay
  (FR-013), and exists so unit and Playwright tests can assert playback state without
  pixel diffing (R12). No control, button or overlay element is ever added — the taken-over
  subtree contains exactly one element.
- `--meme-media-width` carries the post's own `media.width`, which is what the `<img>`
  rendered at: its `width` attribute is a presentational hint setting CSS `width`, and that
  beats srcset density correction. A canvas gets no such hint and would otherwise lay out at
  its backing store (the decoded variant), so the swap would resize the post.
  **Corrected 2026-08-07 (T028/T031):** this replaced a `meme-media__canvas--fluid` modifier
  applying `width: 100%`, written on research R8 mechanic 3's mistaken premise that the
  `<img>` lays out at the `sizes` width. Measured on the dev feed, every image renders at
  exactly its width attribute (500→500, 800→800, 1280→capped to the column), so `width: 100%`
  upscaled a 120 px GIF to 1246 px and broke theme.css's explicit "never upscale" rule
  (FR-009/SC-003).
- In the feed both forms stay wrapped in the existing
  `<Link class="meme-media__link" tabIndex={-1}>`, so the permalink click target is
  unchanged (FR-010, US3 scenario 2). On the permalink page neither is wrapped.
- `.meme-media__canvas` replicates the global `img` reset (`max-width:100%; display:block;
  height:auto; margin-inline:auto`) and takes its width from `--meme-media-width`, so the
  rendered box is identical in both states at every breakpoint (FR-009, SC-003). Verified in
  Chrome: zero layout shifts across the swap, and canvases render 120×120 / 400×200 / 64×64
  exactly as their `<img>` did.
