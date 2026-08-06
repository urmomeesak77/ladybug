# Phase 0 Research: Animated Image Viewport Autoplay

**Feature**: `021-gif-viewport-autoplay` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

The spec arrives fully clarified (9 clarification answers, no open `NEEDS CLARIFICATION`
markers). The open questions here are therefore purely technical: *how* to satisfy
FR-003 (frame-accurate freeze/resume) inside an `<img>`-based feed without adding a
dependency (FR-015), without a server field (FR-016), and without touching video
(FR-004a).

---

## R1 — Mechanism for frame-level control of an animated image

**Decision**: Take the animation over from the `<img>` with the platform's **WebCodecs
`ImageDecoder`**, and paint decoded frames into a `<canvas>` that replaces the `<img>`
in the DOM. The canvas is driven by our own timer, so "stop" means *stop scheduling the
next frame* and "resume" means *schedule from the remembered frame index* — which is
exactly FR-002 + FR-003.

`ImageDecoder` is a platform API, not a package: it satisfies FR-015 / Principle I with
zero additions to `package.json`.

```js
const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' });
await decoder.tracks.ready;          // track metadata available
await decoder.completed;             // frameCount is stable once the data is buffered
const track = decoder.tracks.selectedTrack;   // .animated, .frameCount, .repetitionCount
const { image } = await decoder.decode({ frameIndex: 7 });  // image: VideoFrame
ctx.drawImage(image, 0, 0);
image.close();                       // release the frame's memory immediately
```

**Rationale**: it is the only mechanism in the platform that exposes *individual frames
of an animated image by index*. Everything FR-003 asks for follows directly from being
able to ask for frame *N*.

**Alternatives considered and rejected**:

| Alternative | Why rejected |
|---|---|
| Clear/restore `img.src` (or `loading` / `decoding` attributes) on scroll | Restores from **frame 0** every time — fails FR-003, and the reload flashes (fails SC-008). |
| Snapshot the running `<img>` to a canvas on scroll-out, swap the `<img>` back on scroll-in | Freeze works; **resume does not** — the re-shown `<img>` restarts at frame 0. Fails FR-003. |
| `content-visibility: auto` on the post, letting the UA skip off-screen rendering | Whether an image animation *pauses* (vs. keeps advancing unpainted) is not specified; resume position is therefore not guaranteed and cannot satisfy FR-003 or SC-004. Also needs `contain-intrinsic-size` to avoid reflow, risking SC-003. |
| Serve a static poster variant for animated posts and swap `src` on scroll | Needs a new stored/API field + a backfill over the existing library — banned by FR-016/FR-007 — and still restarts at frame 0. |
| A JS GIF/WebP decoder package (gifuct-js, libwebp-wasm, …) | New runtime dependency — banned by FR-015 and Principle I. |
| Convert animated images to muted looping `<video>` server-side and reuse `useVideoAutoplay` | Re-processing the whole published library (fails FR-007), a backend change the spec explicitly scopes out (FR-014), and a much larger blast radius than the feature warrants. |

---

## R2 — Feature detection and the FR-012 fallback

**Decision**: gate everything on `typeof window !== 'undefined' && 'ImageDecoder' in window`
(plus `ImageDecoder.isTypeSupported(mime)` for the specific format). When the gate is
false — or when *anything* in the takeover path throws — the component simply leaves the
plain `<img>` in the DOM, which is byte-for-byte today's behavior: always animating,
never frozen, never blank. This is FR-012 by construction: the fallback is "don't do the
enhancement", not a second code path with its own failure modes.

**Support reality (Aug 2026)**: `ImageDecoder` ships in Chrome/Edge 94+, Firefox 133+,
Opera and Samsung Internet; **Safari does not support it on macOS or iOS at any version**.
Global support is ~78%. So the fallback is not a theoretical corner — a real and
substantial share of visitors (all of iOS) keeps today's experience, which is precisely
what clarification Q3 accepted. The feature is *progressive*: the set of visitors who get
freeze/resume grows as Safari ships the API, with no code change here.

**Alternatives considered**: shipping a wasm decoder to close the Safari gap (rejected —
FR-015); withholding the feature until Safari ships (rejected — the clarification
explicitly chose to ship with the fallback).

---

## R3 — Deciding "is this media animated" in the browser (FR-016)

**Decision**: two stages, both client-side, no server involvement.

1. **Cheap pre-filter** — only attempt the takeover when the URL the `<img>` actually
   loaded ends in `.gif` / `.webp` (and, once fetched, only when the response's
   `Content-Type` is `image/gif` / `image/webp`). JPEG and PNG posts never fetch, never
   decode, never change — FR-008/SC-007 hold by never entering the path.
2. **Authoritative test** — `decoder.tracks.selectedTrack.animated === true &&
   frameCount > 1`. A single-frame GIF/WebP fails this, the takeover is abandoned, and
   the `<img>` stays exactly as it is: the "natural no-op discovered at render time" the
   spec asks for.

No API field, no DB column, no backfill (FR-016); already-published memes work because
nothing about them needs to change (FR-007).

**Alternative considered**: sniffing the file header in JS (GIF `NETSCAPE2.0` /
WebP `VP8X` animation bit — the backend already does the WebP variant in
`App\Support\WebpFile::isAnimated`). Rejected as redundant: we must construct the decoder
anyway, and the decoder already reports `animated` authoritatively for both formats with
no format-specific parsing to keep in sync across two stacks.

---

## R4 — Getting the bytes without downloading the image twice

**Decision**: `fetch(url, { cache: 'force-cache' })` where `url = img.currentSrc` — the
variant the browser actually selected — and **the probe waits until that value exists**.

- `currentSrc` is the variant the browser *actually* picked from `srcset`, so the fetch
  targets bytes already in the HTTP cache.
- **`media.src` is not a safe substitute.** Feed images carry a real multi-candidate
  `srcset` (`FeedModel.buildSrcset`: every stored size plus the original) with
  `sizes="(min-width: 80rem) 80rem, 100vw"`, while `media.src` is
  `FeedModel.pickImageSource` — the `default` variant. On most viewports the browser picks
  a *different* candidate. Probing `media.src` would therefore mean a second, full download
  of bytes the visitor never sees, a registry keyed on the wrong URL, and a canvas sized
  from the wrong variant (R8 mechanic 3). So the URL comes from the element, not the model.
- **Deferred probe.** `<img loading="lazy">` has an empty `currentSrc` until the browser
  starts fetching it. The hook therefore treats "candidate URL, but `currentSrc` is still
  empty" as *not yet ready*: it attaches a one-shot `load` listener (and re-checks on the
  next `isNear` change) and probes on the first render where `currentSrc` is non-empty. In
  practice lazy loading begins well before the post is on screen, so this costs nothing
  against R8 mechanic 4; in the worst case the takeover simply happens a little later and
  FR-012's "leave the `<img>` alone" covers the interim.
- `force-cache` uses the cached response whenever one exists, without a revalidation
  round trip.
- Media is same-origin (`/storage/…`, served by the nginx service in dev and the edge
  nginx in prod), so no CORS work and no `crossorigin` attribute on the `<img>`.

Worst case (cache miss, e.g. a `no-store` header) is **one extra conditional request per
animated post** — never for JPEG/PNG posts (R3 stage 1). Acceptable; the takeover also
lets us skip the `<img>` download entirely for posts taken over before the lazy `<img>`
starts loading (R8).

**Alternative considered**: `createImageBitmap()` off the loaded `<img>` — gives one
composite frame, no frame index, useless for FR-003.

---

## R5 — The visibility rule (FR-011's two tests), and leaving video alone

**Decision**: a new `useInViewport` hook, used **only** by images. `useVideoAutoplay`
is not touched at all — FR-004a and SC-010 hold trivially because no video code changes.

The hook evaluates, per IntersectionObserver entry:

```
visible = entry.isIntersecting && (
    entry.intersectionRatio >= 0.5                                   // (a) half the image
 || entry.intersectionRect.height >= viewportHeight * 0.5            // (b) half the screen
)
```

with `viewportHeight = entry.rootBounds?.height ?? window.innerHeight`.

Test (a) is *numerically the same rule* `useVideoAutoplay` uses (`threshold: 0.5`), so
FR-004's "starts at the same point in the scroll" for normally sized media is satisfied by
using the same constant.

**Start parity, not stop parity — a deliberate, documented asymmetry (FR-004).**
`useVideoAutoplay` (`src/hooks/useVideoAutoplay.ts:17-24`) branches on
`entry.isIntersecting` alone. Per the IntersectionObserver spec, `isIntersecting` is true
whenever the target overlaps the root *at all* — it is **not** tied to the declared
threshold. So a video *starts* when the ratio crosses 0.5 (the callback fires there and
`isIntersecting` is true), but the callback that fires when the ratio falls back under 0.5
still reports `isIntersecting === true` and calls `play()` again; the video only pauses on
the entry fired when it leaves the viewport completely. `useInViewport` evaluates the ratio
itself, so an animated image freezes at the 0.5 boundary in both directions.

Consequence: image and video begin together and stop apart. That is the intended reading of
FR-004 as amended — copying video's late stop would leave a meme 90% off screen animating
(the exact waste this feature removes), and fixing video's stop would modify the video slice
FR-004a fences off. `useInViewport` therefore does **not** replicate the quirk, and the
divergence is asserted in tests rather than discovered in QA.

Test (b) is unreachable for any image shorter than the viewport (its
visible height can never reach half the screen while less than half of it is on screen…
in fact for an image ≤ viewport height, (b) implies (a)), so no normally sized meme's
behavior changes.

**Threshold granularity**: IntersectionObserver only fires at declared thresholds. Test
(b) can flip while the *ratio* barely moves (a meme three screens tall crosses "half the
screen covered" at ratio ≈ 0.17), so a single `threshold: 0.5` would never fire. The hook
therefore registers a **fine-grained threshold ladder** (`0, 0.02, 0.04 … 1.0`, 51
entries). 2% of a tall meme's height is well under one screen of scrolling, keeping the
start-up inside SC-002's 0.5 s.

**No observers at all for posts that can never be taken over.** The threshold ladder is 51
entries on two observers per post; on a 200-entry JPEG feed that would be 400 observers
doing ladder work for nothing — the opposite of the battery/CPU saving this feature exists
for. `useAnimatedImage` therefore evaluates the two cheap, synchronous gates *first* —
`AnimatedImage.isSupported()` and `AnimatedImage.isCandidate(src)` — and when either is
false it never calls `useInViewport` with a live node, so **zero** IntersectionObservers are
constructed for a JPEG/PNG post or for any post in a browser without `ImageDecoder`. (The
hook is still called unconditionally — Rules of Hooks — but it observes nothing when handed
a `null` node, which is its documented no-op.) FR-008/SC-007 and FR-012/SC-009 hold by
never entering the path, at zero cost.

**Alternatives considered**: a `scroll` listener recomputing `getBoundingClientRect()`
(rejected — a per-post scroll handler on a 200-entry feed is exactly the cost this
feature is trying to save); a second IntersectionObserver with a viewport-sized root
margin trick (rejected — cannot express "covers half the root" as a margin).

---

## R6 — Frame pacing

**Decision**: after drawing frame *i*, schedule frame *i+1* with `setTimeout` for
`clampDelay(image.duration)`, where `image.duration` is the decoded `VideoFrame`'s
duration **in microseconds**:

```
delayMs = duration_us / 1000
if (!Number.isFinite(delayMs) || delayMs < 20) { delayMs = 100 }
```

The `< 20 ms → 100 ms` clamp mirrors what every browser does natively for legacy GIFs
that declare a 0/10 ms delay ("as fast as possible"). Without it, a taken-over GIF would
visibly run *faster* than the same GIF does in the fallback path or in the pre-takeover
`<img>` — an observable inconsistency this feature has no reason to introduce.

The next frame is **decoded immediately after the current one is drawn** and awaited
concurrently with the timer, so a slow decode does not add to the frame interval; if the
decode outlasts the delay the frame is drawn as soon as it lands (dropped-frame
behavior, never a stall).

Freezing discards the *remaining* time of the current frame; resuming gives the resumed
frame its full delay again. Error therefore cannot accumulate across cycles — the
position is an integer frame index, not a clock (SC-004, "no drift over an unlimited
number of cycles").

**Alternative considered**: `requestAnimationFrame` with an accumulator (rejected —
rAF ties frame pacing to display refresh and keeps a callback alive per post; a
`setTimeout` chain that is simply not scheduled while frozen is both simpler and
strictly cheaper).

---

## R7 — Honoring the file's repeat setting (FR-003a)

**Decision**: read `track.repetitionCount` once at probe time.

- `Infinity` → loop forever while visible.
- A finite *n* → the animation plays **n + 1 times** total (the WebCodecs value counts
  *repetitions*, i.e. a GIF with no `NETSCAPE2.0` loop block reports `0` = play once),
  after which the player stops on the **final frame** and sets a sticky `isFinished`
  flag.
- `isFinished` lives with the remembered position (R9), so it survives scroll-away,
  scroll-back and even eviction: a finished meme stays finished and is never granted a
  fresh play-through.
- Because a frozen player schedules nothing, off-screen time cannot advance the loop
  counter — the "off screen never consumes a play-through" half of FR-003a is a
  consequence of the design, not extra code.

---

## R8 — Swapping `<img>` → `<canvas>` without flicker or layout shift

Four mechanics, each mapping to a specific requirement:

1. **Decode before swapping.** The first frame is decoded and held *before* the canvas is
   rendered; the component then swaps and draws it in a `useLayoutEffect`, i.e. before
   the browser paints the new DOM. There is never a painted frame in which the canvas is
   blank (SC-008).
2. **One swap, ever.** Once taken over, a post stays a canvas for the life of the page —
   including while frozen, evicted, or re-acquired. Repeated scroll cycles and
   flick-scrolling therefore involve **no element swap at all**, which is what makes the
   "no repeated placeholder swaps" edge case free.
3. **Identical box — and the `srcset` trap.** The canvas carries the decoded frame's
   intrinsic `width`/`height` attributes, which fixes its aspect ratio, plus a CSS rule
   replicating the global `img` reset (`max-width:100%; display:block; height:auto;
   margin-inline:auto`). That reset **alone is not enough**, because an `<img>` with a
   `w`-descriptor `srcset` + `sizes` does not lay out at its variant's pixel width: the
   browser *density-corrects* it, so the element renders at the `sizes` width (here 100vw,
   capped at 80rem) whatever candidate it picked. A `<canvas>` has no such correction — it
   lays out at its attribute width. Swapping a 640 px-wide decoded frame into a column that
   was rendering the `<img>` at ~1200 px would shrink the post by half: a gross violation of
   FR-009/SC-003, and invisible in any test that only checks the class list.

   The rule is therefore **two-part**, mirroring the two cases the `<img>` itself has:

   | The `<img>` had… | It renders at | The canvas gets |
   |---|---|---|
   | a non-empty `srcset` (the normal case) | the density-corrected `sizes` width — i.e. it fills the column | `.meme-media__canvas--fluid` ⇒ `width: 100%` |
   | an empty `srcset` (`buildSrcset` returned `''`) | its own intrinsic width, capped by `max-width:100%` ("never upscale", theme.css:391) | the base rule only ⇒ `width: auto` |

   `MemeImage` knows which case applies (`media.srcset` is already a prop), so the modifier
   is decided at render time with no measurement, no `ResizeObserver`, and no layout read.
   Aspect ratio comes from the frame attributes in both cases, so the height follows
   automatically and the box is pixel-identical across the swap at every breakpoint.
4. **Take over *before* it is on screen.** The same hook exposes a second, wider
   IntersectionObserver (`rootMargin: '100% 0px'` — one viewport above and below) that
   triggers *acquisition*; playback still waits for the strict rule in R5. So in ordinary
   scrolling the swap happens while the post is still off screen and the canvas begins at
   frame 0 exactly as a freshly loaded GIF would. Acquisition additionally waits for the
   `<img>` to have selected its source (R4's deferred probe) — the two conditions are
   `isNear && currentSrc !== ''`.

**Accepted cosmetic limitation**: for an animated post that is *already on screen at page
load*, acquisition and visibility coincide, so the `<img>` animates for the few hundred
milliseconds the fetch+decode takes and then the canvas restarts it at frame 0 — a
one-time, sub-second frame jump on first takeover only. Eliminating it would require
knowing the `<img>`'s current frame index, which no API exposes; approximating it by
summing frame durations from the load timestamp would mean decoding every frame up front
(expensive, and wrong the moment the tab was backgrounded). Documented rather than
engineered around; it does not affect FR-003, which governs *resume after leaving*.

---

## R9 — Bounded playback resources (FR-017/018/019)

**Decision**: split what is remembered from what is held, in one module-level
`AnimationRegistry`:

| | Contents | Bound | Lifetime |
|---|---|---|---|
| **positions** | `{ frameIndex, loopsDone, isFinished }` per media URL — plain numbers/booleans | none needed (tens of bytes each; ≤ 200 posts per feed page) | page lifetime (FR-018) |
| **sessions** | `{ decoder, frameCount, repetitionCount }` per media URL — the expensive part | **12** (FR-017) | LRU |

- The `sessions` map is a `Map`, which iterates in insertion order; "touch" = `delete`
  then `set`, so the least-recently-used key is always `sessions.keys().next().value`.
  Over the cap → `decoder.close()` on the evicted session and drop it.
- **The evicted post keeps showing its frozen frame** — those pixels live in the canvas
  bitmap, which is unaffected by closing the decoder. No blank, no restart (FR-019).
- **Actively playing posts are never the eviction victim** — and this is *enforced*, not
  argued. Recency alone is not enough: acquisition fires on `isNear`, a band three
  viewports tall, which on a feed of short animated posts can easily hold more than 12
  candidates. A pure LRU would then evict sessions that are still on screen and re-acquire
  them moments later — decoder thrash, and exactly the churn FR-017 is meant to avoid. The
  registry therefore takes a **pin**: `AnimationPlayer.start()` pins its URL,
  `stop()` unpins it, and eviction picks the least-recently-used **unpinned** session. If
  every one of the 12 were pinned (pathological — it needs 12 posts simultaneously passing
  the R5 visibility test), the LRU is evicted anyway so `sessions.size ≤ 12` never breaks;
  that player's next decode rejects and re-acquires under guarantee 5, which is already the
  designed path.
- **Re-acquisition is transparent**: the player asks the registry for the session before
  each decode; a cache miss re-fetches (HTTP cache) and re-constructs the decoder. In-flight
  acquisitions are deduped by storing the promise, so a burst of scroll events cannot
  start two decoders for one post.
- A `decode()` in flight when its decoder is closed rejects; the player catches,
  re-acquires once, and continues (fast scrolling is the realistic trigger).
- **Unmount** (navigating away from the feed) stops the player's timer but leaves the
  session cached — the LRU already bounds it, and a Back navigation then resumes
  instantly.
- `AnimationRegistry.reset()` exists for tests, which must not share state across cases.

---

## R10 — Memory hygiene

`VideoFrame` objects hold GPU/system memory that garbage collection does **not** reclaim
promptly — every decoded frame is `close()`d immediately after `drawImage`. The canvas
context is created once with the default alpha and each frame is preceded by
`clearRect`, so a transparent GIF/WebP frame does not composite over the previous one.
(ImageDecoder already yields fully composited frames, i.e. GIF disposal methods are the
decoder's problem, not ours.)

---

## R11 — Testing in jsdom (Principle VII, ≥90% lines over all of `src/`)

jsdom provides neither `IntersectionObserver`, nor `ImageDecoder`, nor a canvas 2D
context. All three are stubbed per-test with `vi.stubGlobal` /
`vi.spyOn(HTMLCanvasElement.prototype, 'getContext')`, following the existing
`tests/hooks/useVideoAutoplay.test.tsx` mock-observer pattern (captured instances, driven
manually) — no new test dependency.

The design is deliberately shaped for this: `AnimationRegistry` and `AnimatedImage` are
plain classes with no React inside, `AnimationPlayer` is an instance class driven by
`vi.useFakeTimers()`, and only the thin `useAnimatedImage` glue needs a rendered harness.
Fallback coverage (no `ImageDecoder`) is just "don't stub the global".

---

## R12 — End-to-end coverage

**Decision**: one Playwright spec, `tests/e2e/animated-image.spec.ts`, modeled directly
on the existing `tests/e2e/video-playback.spec.ts` (register → verify → upload →
promote/activate → assert on the feed and the permalink). The e2e project is
**chromium-only**, so `ImageDecoder` is available and the takeover path is genuinely
exercised.

- Fixtures: `backend/tests/fixtures/animated.webp` already exists (added in 014). One
  small animated GIF fixture (`backend/tests/fixtures/animated.gif`) is added alongside
  it for the GIF half of FR-006/SC-006.
- Observability without new chrome (FR-013): the canvas carries a
  `data-playing="true|false"` attribute reflecting the player state. An attribute is
  invisible to visitors — no control, no overlay — and gives Playwright (and the unit
  tests) a deterministic assertion instead of pixel diffing.
- The upload pipeline preserves animation in the served variants for both formats
  (`GifFile` → gifsicle, `WebpFile` → ImageMagick), so the variant the feed loads really
  is animated — verified in `TrashpostImageProcessor::resizerFor`.

---

## R13 — Known risk to verify manually: color fidelity

Drawing a `VideoFrame` to a 2D context is the documented ImageDecoder usage and should be
pixel-identical for image-derived (RGBA) frames, but Chromium's frame formats have
historically caused subtle shifts for *video*-derived frames. `quickstart.md` therefore
includes an explicit side-by-side check (canvas vs. the same GIF in the fallback path)
before the feature is called done. If a shift ever appears, the fix is local
(`createImageBitmap(frame)` before drawing) and changes no interface.

---

## R14 — Dependency check (Principle I / FR-015)

**No new npm package, no new Composer package, no new system binary.** The feature uses
`ImageDecoder`, `IntersectionObserver`, `<canvas>`, `fetch` and `setTimeout` — all
platform. `package.json` is untouched. The backend is not touched at all (FR-014):
this is a frontend-only feature.

---

## R15 — Where the code lives

Follows the established layout (one class per `lib/` module, hooks in `hooks/`,
components in `components/`, tests mirroring source paths):

| New module | Kind | Responsibility |
|---|---|---|
| `src/lib/animatedImage.ts` | class, static | Support probe, candidate-URL filter, fetch+construct decoder, frame-delay clamp |
| `src/lib/animationRegistry.ts` | class, static | LRU of 12 sessions + unbounded frame-position memory (R9) |
| `src/lib/animationPlayer.ts` | class, **instance** | One post's frame loop: start/stop, draw, loop counting |
| `src/hooks/useInViewport.ts` | hook | FR-011 dual visibility test + the wider acquisition margin |
| `src/hooks/useAnimatedImage.ts` | hook | Glue: probe on approach, swap on ready, play/freeze on visibility |
| `src/components/MemeImage.tsx` | component | The image branch of `MemeMedia`: `<img>` ⇄ `<canvas>`, broken-image state, permalink wrapper |

`AnimationPlayer` is the one instance class among `lib/`'s static-only modules: it owns
genuinely per-post mutable state (current frame, timer handle, loop count) that a static
API would have to fake with a keyed map. Documented here so it does not read as a
convention slip.

**Changed**: `src/components/MemeMedia.tsx` (image branch delegates to `MemeImage`),
`src/styles/theme.css` (the `.meme-media__canvas` rule plus its `--fluid` modifier, R8
mechanic 3). Nothing else.

---

## R16 — A hidden tab must not keep playing (FR-002a)

**Decision**: `useAnimatedImage` folds `document.visibilityState` into the play condition —
`shouldPlay = isVisible && !document.hidden` — and subscribes once to `visibilitychange`.

**Why it needs saying**: the platform pauses an `<img>`'s own animation in a backgrounded
tab, so today's behavior is already "frozen while hidden". Once *we* drive the frames, that
guarantee is gone: browsers throttle background `setTimeout` to roughly once a second but do
not stop it. A backgrounded tab would therefore keep advancing frames at a limp 1 fps —
burning CPU for nobody, drifting the remembered position away from what the visitor last
saw, and slowly spending a play-once meme's single play-through (FR-003a). Left alone this
would be a regression the feature *introduces*, in the one corner the spec had assumed was
free.

Treating hidden as not-visible costs one listener for the whole page and reuses the existing
freeze path verbatim: the position is persisted by the same `stop()`, and returning to the
tab resumes on the held frame like any scroll-back. `visibilitychange` is universally
supported, including on the Safari fallback path where it is simply never consulted.

**Alternative considered**: putting the check inside `AnimationPlayer` (rejected — the
player's job is frames, not policy; every other "should this be running" decision already
lives in the hook, and a per-post listener on a 200-entry feed is the cost R5 avoids).
