# Phase 1 Data Model: Animated Image Viewport Autoplay

**Feature**: `021-gif-viewport-autoplay` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

## Persistent data: none

This feature adds **no** database table, column, index or migration, and **no** field to
any API response (FR-014, FR-016). `trashposts` is untouched; `TrashpostResource` is
untouched; `RawPost` / `FeedPost` / `FeedMedia` in `frontend/src/lib/feedModel.ts` are
untouched. Whether a post is animated is discovered in the browser from the image file it
already downloads (research R3), which is also why every meme published before this
feature behaves identically to a new one with no backfill (FR-007).

The only "entity" the spec names — **Post** — is therefore listed for completeness as
*unchanged in shape and unchanged in what it reports*.

## Client-side state (all in-memory, page-lifetime at most)

### 1. `FramePosition` — the remembered playback point (FR-018)

One per animated media URL. Retained for the whole page session, **including for posts
whose session has been evicted** — this is what makes a released post resume rather than
restart (FR-019).

| Field | Type | Meaning | Rules |
|---|---|---|---|
| `frameIndex` | `number` | The frame shown when playback last stopped | `0 ≤ frameIndex < frameCount`; starts at `0`; advances only while playing (FR-002 ⇒ off-screen time never advances it) |
| `loopsDone` | `number` | Completed play-throughs | Incremented when `frameIndex` wraps past the last frame |
| `isFinished` | `boolean` | The file's repeat allowance is spent (FR-003a) | Sticky once true — a finished meme never replays, and never gains a play-through while frozen |

Size: three numbers/booleans per animated post. A full 200-entry feed page of nothing but
animated posts costs a few kilobytes, so no cap is needed (contrast FR-017, which caps the
*expensive* half below).

### 2. `PlaybackSession` — the expensive, capped resource (FR-017)

One per animated media URL, held only for the **12 most-recently-used** (research R9).

| Field | Type | Meaning |
|---|---|---|
| `decoder` | `ImageDecoder` | The live decoder; `close()`d on eviction |
| `frameCount` | `number` | Frames in the selected track (`> 1`, else the post is not animated and no session is created) |
| `repetitionCount` | `number` | `Infinity`, or a finite count meaning `n + 1` total play-throughs (research R7) |

**State transitions**

```
absent ──acquire()──▶ pending(Promise) ──resolved──▶ live ──evicted(LRU>12)──▶ absent
                            │                                                    │
                            └──── probe says "not animated" / any error ──────────┘
                                          ▼
                                    static (terminal: no session, no canvas,
                                            <img> stays — FR-008 / FR-012)
```

`absent → live` is transparent to the caller and preserves `FramePosition`, so an evicted
post re-readies itself on scroll-back with no visible difference (FR-019, SC-011).

### 3. `AnimationRegistry` — the module-level owner

Holds the two maps above plus one small set:

- `positions: Map<url, FramePosition>` — uncapped, page lifetime.
- `sessions: Map<url, PlaybackSession | Promise<PlaybackSession>>` — **capped at 12**,
  LRU by insertion order (touch = delete + re-set; evict the least-recently-used
  *unpinned* key, falling back to `keys().next()` if all are pinned).
- `pinned: Set<url>` — URLs whose player is currently running. `AnimationPlayer.start()`
  adds, `stop()` removes. It exists because acquisition fires across a three-viewport band
  that can hold more than 12 candidates, so plain recency is not enough to keep a visible,
  playing post out of the eviction path (research R9).

Key: **the media URL the browser actually selected** — `img.currentSrc`, not `media.src`.
Feed images carry a multi-candidate `srcset`, so the two differ on most viewports; keying on
`media.src` would decode a variant the visitor is not looking at (research R4). It is
stable, unique per post variant, and requires no new identifier — the post `hash`
(Principle V) is unchanged and unused here.

`reset()` clears both maps and closes live decoders; tests call it between cases.

### 4. Per-component render state (`useAnimatedImage`)

| State | Type | Drives |
|---|---|---|
| `node` | `HTMLElement \| null` | Callback-ref target — the `<img>` before takeover, the `<canvas>` after; re-arms the observers on swap |
| `takeover` | `{ width, height } \| null` | `null` ⇒ render the `<img>` (today's behavior); set ⇒ render the `<canvas>` at those intrinsic dimensions (FR-009) |
| `isBroken` | `boolean` | Existing behavior, unchanged — a failed image degrades the post to title-only |
| `isPageVisible` | `boolean` | `!document.hidden`, from one `visibilitychange` subscription. ANDed with `isVisible` to decide `start()`/`stop()`, so a backgrounded tab freezes instead of limping along on throttled timers (FR-002a, research R16) |

The canvas's rendered width is **not** state: `--meme-media-width` is derived at render time
from `media.width`, the same number the `<img>`'s width attribute carries, so it needs no
measurement and cannot go stale on resize. (It replaced a `--fluid` modifier keyed on
`media.srcset !== ''` that applied `width: 100%` — see T031; that upscaled every post whose
media was narrower than the column.)

`takeover` is one-way: once set it is never cleared (research R8 — "one swap, ever"),
which is what makes flick-scrolling flicker-free (SC-008).

## Invariants

1. A post that never becomes animated-and-decodable keeps a plain `<img>` forever — no
   canvas, no fetch for JPEG/PNG, and (for a non-candidate URL or an unsupported browser)
   no IntersectionObserver constructed at all (FR-008, SC-007, research R5).
2. `positions` is only ever written by the player that owns the canvas, and only while
   that player is running — so nothing off screen can mutate a remembered frame.
3. `sessions.size ≤ 12` at every observable moment (FR-017, SC-011) — pinning changes
   *which* session is evicted, never *whether* one is.
4. Closing a decoder never changes what is on screen: the frozen frame lives in the
   canvas bitmap, not in the session (FR-019).
5. No state here outlives the page. A reload starts every position at frame 0, which is
   indistinguishable from today's behavior on a fresh load.
6. `pinned ⊆ sessions.keys()` and a pinned session is evicted only when every session is
   pinned; `stop()` always unpins, including the `stop()` React cleanup fires on unmount, so
   a pin can never leak and permanently shrink the usable cache (research R9).
7. A post whose `src` is not a `.gif`/`.webp` candidate, or any post in a browser without
   `ImageDecoder`, allocates **nothing** here — no position, no session, and no
   IntersectionObserver anywhere (FR-008/SC-007, FR-012/SC-009).
