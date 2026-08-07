# Quickstart: Validating Animated Image Viewport Autoplay

**Feature**: `021-gif-viewport-autoplay` | **Spec**: [spec.md](./spec.md) |
**Contracts**: [contracts/frontend-playback.md](./contracts/frontend-playback.md)

## Prerequisites

- Dev stack running (`docker compose up`); frontend on `:5173`, media served through the
  nginx service on `:8000`.
- **Chrome or Edge** (94+) for the enhanced path — these support `ImageDecoder`.
  **Safari** (any version, macOS or iOS) is the fallback path and is needed for
  Scenario 6. Firefox 133+ also has the enhanced path.
- Test media, all posted through `/upload` with a verified account (auto-activating —
  `rating >= 15` or admin+ — otherwise activate them from `/admin/trashposts` first):
  - at least **3 animated GIFs**, ideally a few hundred pixels tall, so only one is on
    screen at a time;
  - **1 animated WebP** (`backend/tests/fixtures/animated.webp` works);
  - **1 single-frame GIF or WebP** (`backend/tests/fixtures/static.webp`);
  - **1 JPEG/PNG** and **1 video post** (regression controls);
  - **1 very tall animated GIF** — taller than your browser window (Scenario 4).
- DevTools open on the **Network** and **Console** panels for the first pass.

Nothing needs re-uploading or migrating: any animated meme already in the library is a
valid subject (FR-007), so existing feed content works too.

---

## Scenario 1 — Only what's on screen moves (US1, FR-001/002/003, SC-001/004)

1. Load `/` and scroll slowly to the first animated post.
   - **Expect**: it animates once roughly half of it is on screen — no click needed,
     and within ~half a second of crossing that point (SC-002).
   - **Expect** (DevTools → Elements): the element is now a
     `<canvas class="meme-media meme-media__image meme-media__canvas" data-playing="true">`,
     not an `<img>`.
2. Keep scrolling until it is past the top edge.
   - **Expect**: it stops on a frame of the meme — a recognisable picture, not blank,
     not a broken-image icon, not a different size (US3 scenario 1).
   - **Expect**: `data-playing="false"`.
3. Scroll back up to it.
   - **Expect**: it **continues from the frame it froze on** — not from the start.
     Easiest way to be sure: pick a GIF with a distinctive mid-loop moment, freeze it
     there, and confirm that exact frame is still showing when you return.
4. Repeat step 2–3 **ten times** on the same post.
   - **Expect**: resume is correct every time, with no drift back to frame 0 and no
     jump forward (SC-004).
5. With two animated posts on screen at once, confirm **both** animate — the feature
   does not pick one winner (edge case).

## Scenario 2 — GIF and WebP are indistinguishable (FR-006, SC-006)

1. Put the animated WebP post and an animated GIF post in the feed.
2. Run Scenario 1 steps 1–3 against each.
   - **Expect**: identical start, stop and resume behavior; nothing in the visible
     behavior reveals which format it is.

## Scenario 3 — Same rule as video, and video is untouched (FR-004/004a, SC-010)

1. Place an animated post and a video post so each fits fully on screen.
2. Scroll each into view slowly, watching where playback begins.
   - **Expect**: both start at effectively the same scroll position (both use the
     half-visible rule).
3. Now scroll each back *out* slowly, watching where playback ends.
   - **Expect**: both stop at effectively the same point — once less than half is left on
     screen. **Corrected 2026-08-07 (T028):** earlier drafts of this step predicted the
     video would keep playing until full exit. It does not. `useVideoAutoplay` declares
     `threshold: 0.5`, and a declared threshold makes `isIntersecting` track that threshold
     (measured in Chrome: `false` at ratio 0.25, `true` at 0.75), so video pauses on the same
     half-visible boundary. There is no "image stops earlier" asymmetry to look for.
   - The real divergence is Scenario 4's: a meme taller than twice the window can never
     reach ratio 0.5, so an animated image keeps playing on the covers-half-the-window rule
     where a video of the same shape would pause. The image is more forgiving, not less.
4. Exercise the video post normally: autoplay on entry, pause on exit, the
   play/pause/mute buttons and the scrub bar.
   - **Expect**: no change whatsoever from before this feature (SC-010). The video
     `<video>` element must still be a `<video>` — never a canvas.

## Scenario 4 — A meme taller than the screen (FR-011, edge case)

1. Scroll to the very tall animated GIF, ideally on a narrow/short window (or DevTools
   device toolbar at ~360×640) so that half of the image can never be on screen.
   - **Expect**: it animates once its visible part covers about half the window height —
     it must **not** stay permanently frozen.
2. Scroll until only a sliver is showing.
   - **Expect**: it freezes.
3. For contrast, do the same with a video taller than the window.
   - **Expect**: unchanged, today's behavior (this feature deliberately does not extend
     the second test to video — FR-004a).

## Scenario 5 — Nothing else changed (US3, FR-008/009/010, SC-003/007)

1. Click a frozen animated post in the feed.
   - **Expect**: navigates to `/posts/{hash}` exactly as any image post does.
2. Scroll past the JPEG/PNG post and the single-frame GIF/WebP post.
   - **Expect**: no visible difference from before, no flicker, no swap. In DevTools they
     are still `<img>` elements, and the Network panel shows **no extra request** for
     them (only `.gif`/`.webp` posts are ever probed).
3. Watch a post cross the start/stop boundary while looking at the page layout.
   - **Expect**: zero layout shift — nothing below it moves by a pixel (SC-003). Confirm
     with DevTools → Rendering → **Layout Shift Regions** if you want it objective.
   - **Also check the *takeover* itself**, which is the riskier moment: note the post's
     rendered width just before it becomes a canvas and just after. They must match. Do
     this at a **narrow** window too (~500 px), where the browser picks a small `srcset`
     variant and a naively sized canvas would visibly shrink the post (research R8
     mechanic 3). DevTools → Network shows which variant was selected; the canvas's
     `width` attribute will be that variant's pixel width while its *rendered* width stays
     the column width.
4. Inspect a taken-over post's accessibility node (DevTools → Accessibility).
   - **Expect**: role `image` with the post's title/alt text as its name (FR-010).
5. **Flick-scroll** rapidly up and down through the animation-heavy part of the feed.
   - **Expect**: no flicker, no placeholder swap, no size change (SC-008).
6. Scroll to the bottom so the next batch of 10 loads in.
   - **Expect**: the arrival of new entries neither stops a post still on screen nor
     starts an off-screen one (edge case).

## Scenario 6 — The fallback path (FR-012, SC-009)

Either open the feed **in Safari**, or simulate a browser without the API in Chrome:
in the Console, before loading the page, run `delete window.ImageDecoder` via a DevTools
"Run snippet on load" — or simply test in Safari, which is the real case.

- **Expect**: every animated post renders and animates exactly as it does today —
  continuously, never frozen, never blank, never broken.
- **Expect**: static images, video posts and permalink clicks all behave normally.
- **Expect** (Network panel): no media byte-range/duplicate fetches for animated posts —
  the probe path is never entered.

## Scenario 7 — Deep feed, bounded memory (FR-017/018/019, SC-011)

1. Scroll a feed containing **more than 12 animated posts** all the way down (up to the
   200-entry page break).
2. Scroll back to an animated post you passed very early — one that is well beyond the
   12 most recently seen.
   - **Expect**: it looks no different from a recent one: no blank, no flicker, no
     restart from frame 0 — it resumes on the frame it froze on (FR-019).
   - **Expect**: it becomes ready again quickly (well under a second, SC-002).
3. Optional, objective check: DevTools → Memory → take a heap snapshot before and after
   the long scroll.
   - **Expect**: no growth proportional to how many animated posts were scrolled past.

## Scenario 8 — The permalink page (US2, FR-005)

1. Open an animated meme's `/posts/{hash}` directly.
   - **Expect**: it animates on arrival.
2. Scroll down into the comment section until the image is off screen.
   - **Expect**: it stops.
3. Scroll back up.
   - **Expect**: it resumes from the frame it froze on.

## Scenario 9 — Repeat settings and fidelity (FR-003a, R13)

1. Post a **play-once** GIF (one whose file declares no loop / a finite loop count).
   - **Expect**: it plays through once and rests on its final frame — same as today.
   - **Expect**: scrolling away and back does **not** restart it or grant another play.
   - **Expect**: leaving it off screen for a minute does not consume its play — an
     endless-loop GIF next to it should still be looping when you return.
2. Put the same GIF side by side with the fallback path (Scenario 6, e.g. Safari or a
   second window with the API removed) and compare a still frame.
   - **Expect**: colors, sharpness and transparency look the same in both. This is the
     one known risk of painting decoded frames to a canvas (research R13) — check it
     explicitly before calling the feature done.

## Scenario 10 — Theme and responsive (Constitution IV, VIII)

1. Toggle OS light/dark while an animated post is visible.
   - **Expect**: unchanged surroundings; the canvas is media, not chrome, so nothing
     theme-dependent should shift.
2. Resize across ~360px, tablet and wide desktop.
   - **Expect**: the animated post scales exactly as the `<img>` did — no horizontal
     scroll, no clipping, no aspect-ratio distortion.

## Scenario 11 — A meme that predates this feature (FR-007, SC-005)

Do **not** use a freshly uploaded fixture for this one — the whole point is that nothing
about the meme was touched.

1. Pick an animated GIF or WebP that was already in the library before this branch (any
   older feed entry; `/admin/trashposts` sorted oldest-first will find one).
2. Run Scenario 1 steps 1–3 against it.
   - **Expect**: identical behavior to a meme uploaded today — start, freeze, resume from
     the frozen frame. No re-upload, no reprocessing, no admin action of any kind.
3. In the Network panel, confirm the media request is served from the same `/storage/…`
   URL it used before this feature.
   - **Expect**: the URL is unchanged (FR-014) and the probe fetch hits the **same** URL
     the `<img>` selected — one entry, from cache, not a second full download of a
     different variant (research R4).

## Scenario 12 — A backgrounded tab stops (FR-002a, SC-012)

1. With an animated post playing on screen, note the frame it is on, then switch to another
   tab (or minimise the browser) for at least a minute.
2. Come back.
   - **Expect**: it is on the frame it held when you left — not somewhere further along
     (our timer must not have been limping on in the background) and not back at frame 0.
3. Repeat with the **play-once** GIF from Scenario 9, after it has already finished, and
   with one that has not yet started.
   - **Expect**: a minute hidden consumes no part of its single play-through — the
     unstarted one still plays its full run when you return (FR-003a).

---

## Automated coverage (reference, not manual steps)

Unit (Vitest, jsdom — `cd frontend && npm test`; the ≥90% line gate covers all of `src/`):

- `frontend/tests/lib/animatedImage.test.ts` — support gate, candidate filter, probe
  returning null for still/unsupported/error cases, frame-delay clamp.
- `frontend/tests/lib/animationRegistry.test.ts` — LRU cap of 12, eviction closes the
  decoder, eviction skips **pinned** (currently playing) sessions, positions survive
  eviction, concurrent `acquire` dedupe, `reset`.
- `frontend/tests/lib/animationPlayer.test.ts` — resume from the frozen frame across
  cycles, `repetitionCount + 1` play-throughs then rest on the last frame, frames
  `close()`d, no timer while stopped (fake timers).
- `frontend/tests/hooks/useInViewport.test.tsx` — both FR-011 tests, the near margin,
  observer teardown/re-arm on node change, zero observers for a `null` node, and the
  FR-004 stop asymmetry (false below the ratio while still intersecting).
- `frontend/tests/hooks/useAnimatedImage.test.tsx` — takeover only after a successful
  probe, no probe (and no observers) when unsupported or non-candidate, probing
  `currentSrc` rather than `media.src` and deferring until the `<img>` has one,
  play/freeze on visibility, freeze while the page is hidden, stop on unmount.
- `frontend/tests/components/MemeImage.test.tsx` + updated
  `frontend/tests/components/MemeMedia.test.tsx` — `<img>` markup unchanged pre-takeover,
  canvas markup/ARIA/`data-playing`/`--fluid` post-takeover (both `srcset` cases), permalink
  wrapper in both states, no control element added, broken-image degradation unchanged.

End-to-end (Playwright, chromium — `scripts\e2e.ps1`):

- `frontend/tests/e2e/animated-image.spec.ts` — upload + activate an animated GIF and an
  animated WebP, then assert `data-playing` flips false on scroll-away and true on
  scroll-back, on both the feed and the permalink (mirrors `video-playback.spec.ts`).

Backend: **no changes and no new tests** — this feature does not touch `backend/`.
