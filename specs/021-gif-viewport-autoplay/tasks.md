---

description: "Task list for 021-gif-viewport-autoplay — Animated Image Viewport Autoplay"
---

# Tasks: Animated Image Viewport Autoplay

**Input**: Design documents from `/specs/021-gif-viewport-autoplay/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/frontend-playback.md](./contracts/frontend-playback.md),
[quickstart.md](./quickstart.md)

**Tests**: INCLUDED. Constitution Principle VII makes ≥90% line coverage over all of
`frontend/src/` a CI gate, and quickstart.md §"Automated coverage" names the exact test
files. Every implementation task is therefore preceded by its failing-test task (TDD).

**Scope reminder**: **frontend-only**. `backend/` app code, migrations, resources, routes
and tests are NOT touched (FR-014, plan.md Summary). The single backend-directory change is
one binary e2e *fixture*.

**Organization**: grouped by user story. US1 (feed) is the MVP; US2 (permalink) and US3
(no regressions) build on the same single change point, `MemeMedia`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 — setup, foundational and polish tasks carry no story label

## Path Conventions

Two-app layout (`backend/` + `frontend/`); this feature edits `frontend/` only.
Frontend source is `frontend/src/`, tests mirror it under `frontend/tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The two zero-logic assets the later phases depend on. No dependency changes —
`frontend/package.json` and `backend/composer.json` MUST stay byte-identical (FR-015,
Principle I, research R14).

- [X] T001 [P] Add a small animated GIF fixture at `backend/tests/fixtures/animated.gif` (a
      few frames, a few KB, genuinely multi-frame with a `NETSCAPE2.0` loop block) for the
      Playwright spec's GIF half of FR-006/SC-006; `backend/tests/fixtures/animated.webp`
      already exists from 014 and is reused as-is. Fixture only — no backend code, no
      backend test change (research R12).
- [X] T002 [P] Add the `.meme-media__canvas` rule **and its `--fluid` modifier** to
      `frontend/src/styles/theme.css` next to the existing `.meme-media__image` rule
      (theme.css:391):
      - `.meme-media__canvas { max-width: 100%; display: block; height: auto;
        margin-inline: auto; }` — the global `img` reset the canvas does not inherit.
      - `.meme-media__canvas--fluid { width: 100%; }` — the **density-correction
        equivalent**. An `<img>` with a `w`-descriptor `srcset` + `sizes` does not lay out
        at its variant's pixel width; the browser corrects it to the `sizes` width. A canvas
        has no such rule and would lay out at its attribute width, shrinking a post by half
        when a small variant was selected. The modifier is applied iff the `<img>` had a
        non-empty `srcset` (research R8 mechanic 3, contracts §"DOM contract").
      Both comments explain *why* (canvas has no UA `max-width` reset; canvas has no density
      correction), per docs/CODING_CONVENTIONS.md. FR-009, SC-003, Principle VIII.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three `lib/` classes and two hooks from contracts/frontend-playback.md.
None of them touches the DOM tree of a post, so nothing here is visitor-observable — but
every user story depends on all of it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Constitution notes for this whole phase**: 2-space TS, semicolons, `is`-prefixed booleans,
every function < 50 lines, one class per `lib/` module called through the class
(docs/CODING_CONVENTIONS.md). `AnimationPlayer` is deliberately the one *instance* class —
document that at the top of the file, citing research R15, so it does not read as a slip.

### `AnimatedImage` — support gate, candidate filter, probe, delay clamp

- [X] T003 [P] Write failing unit tests in `frontend/tests/lib/animatedImage.test.ts` covering
      the contract in contracts/frontend-playback.md §`lib/animatedImage.ts`: `isSupported()`
      false when `ImageDecoder` is absent from `window` and true when stubbed;
      `isCandidate()` true for `.gif`/`.webp` URLs (incl. query strings) and false for
      `.jpg`/`.png`/`.mp4`; `probe()` resolving `null` for — unsupported env, non-candidate
      URL, non-`image/gif|webp` `Content-Type`, `animated === false`, `frameCount <= 1`, a
      rejecting `fetch`, and a throwing `ImageDecoder` constructor — resolving
      `{ decoder, frameCount, repetitionCount }` for a multi-frame stub, and never fetching
      for a non-candidate URL; `frameDelayMs()` returning `duration/1000` for normal values
      and `100` for `null`, `NaN`, `Infinity`, `0` and anything `< 20 ms` (research R6).
      Stub `ImageDecoder` and `fetch` with `vi.stubGlobal` (research R11) — no new test dep.
- [X] T004 Implement class `AnimatedImage` (static methods only) in
      `frontend/src/lib/animatedImage.ts` to the contract, making T003 pass: the
      `'ImageDecoder' in window` + `ImageDecoder.isTypeSupported(mime)` gate (research R2),
      the extension pre-filter (research R3 stage 1), `fetch(url, { cache: 'force-cache' })`
      → `new ImageDecoder({ data, type })` → `await tracks.ready` / `completed` →
      `selectedTrack.animated && frameCount > 1` (research R3 stage 2, R4), and the
      `<20 ms ⇒ 100 ms` legacy-GIF clamp. **Guarantee: never throws** — every failure path
      resolves `null`, which is FR-012's "leave the `<img>` alone".

### `AnimationRegistry` — LRU(12) sessions + page-lifetime positions

- [X] T005 [P] Write failing unit tests in `frontend/tests/lib/animationRegistry.test.ts`
      covering contracts §`lib/animationRegistry.ts` guarantees 1–5 and data-model.md §2–§3:
      `position()` returns `{ frameIndex: 0, loopsDone: 0, isFinished: false }` for an unseen
      URL and allocates no session (purity); `savePosition`/`position` round-trip;
      `acquire()` caches so a second call decodes once; two overlapping `acquire(url)` calls
      share one in-flight promise (dedupe); `sessions.size` never exceeds **12** after any
      call; the 13th acquire evicts the least-recently-used URL and calls `decoder.close()`
      on it **exactly once**; `peek()` returns `null` for an evicted/absent URL without
      re-creating; re-acquiring an evicted URL rebuilds the session and leaves its saved
      `FramePosition` untouched (FR-018/FR-019); `acquire` resolving `null` when
      `AnimatedImage.probe` returns `null`; `reset()` closes every live decoder and clears
      both maps and the pin set. **Pinning (guarantee 6, research R9)**: with 12 sessions
      held and one of them pinned, the 13th `acquire` evicts the least-recently-used
      **unpinned** session and leaves the pinned one live *even when the pinned session is
      the least-recently-used of all*; with all 12 pinned, the 13th acquire still evicts the
      LRU so `sessions.size` never exceeds 12 (guarantee 1 wins); `unpin` returns a session
      to the eviction pool; `unpin` of an unknown URL is a no-op.
- [X] T006 Implement class `AnimationRegistry` (static) in
      `frontend/src/lib/animationRegistry.ts` to the contract, making T005 pass: module-level
      `positions: Map<string, FramePosition>` (uncapped, page lifetime) and
      `sessions: Map<string, PlaybackSession | Promise<PlaybackSession>>` capped at a
      `MAX_SESSIONS = 12` constant, LRU by `Map` insertion order (touch = `delete` + `set`),
      plus `pinned: Set<string>` with `pin()` / `unpin()`. Eviction walks
      `sessions.keys()` for the first **unpinned** key and falls back to
      `sessions.keys().next().value` when every session is pinned — a comment explains *why*
      the pin exists (acquisition spans three viewports, which can hold more than 12
      candidates, so recency alone would evict a post that is still playing — research R9).
      Delegates decode setup to `AnimatedImage.probe` (T004). Export the `FramePosition` and
      `PlaybackSession` types from this module (data-model.md §1–§2) — colocated types, per
      the project's no-`types/`-dir convention.
- [X] T007 [P] Write failing unit tests in `frontend/tests/lib/animationPlayer.test.ts` under
      `vi.useFakeTimers()`, covering contracts §`lib/animationPlayer.ts` guarantees 1–7:
      `start()` draws the remembered frame and schedules the next after
      `AnimatedImage.frameDelayMs`; `stop()` clears the timer, persists
      `{ frameIndex, loopsDone, isFinished }` via `AnimationRegistry.savePosition`, and
      advancing fake timers afterwards decodes **nothing** (FR-002/FR-003a); `start()` after
      `stop()` resumes on the frozen frame across **10** cycles with no drift (FR-003,
      SC-004); `repetitionCount: 0` yields exactly one play-through then rests on the final
      frame with `isFinished` persisted, and a later `start()` is a no-op (FR-003a);
      `repetitionCount: 2` yields exactly three; `repetitionCount: Infinity` keeps looping;
      every decoded frame is `close()`d after `drawImage` (research R10); a rejecting
      `decode()` re-acquires once and continues, and a second failure stops on the current
      frame without blanking the canvas; `start()`/`stop()` are idempotent; **`start()` pins
      the URL and `stop()` unpins it** (guarantee 7 — assert via `AnimationRegistry.pin` /
      `unpin` spies, including the unpin on the finished-playback stop, so a play-once meme
      cannot hold a pin forever, data-model invariant 6). Stub the canvas
      2D context via `vi.spyOn(HTMLCanvasElement.prototype, 'getContext')` (research R11).
- [X] T008 Implement class `AnimationPlayer` (instance) in
      `frontend/src/lib/animationPlayer.ts` to the contract, making T007 pass:
      `constructor(url, canvas)`, `start()`, `stop()`, `get isPlaying()`; a `setTimeout`
      chain (never `requestAnimationFrame` — research R6) that draws frame *i*, kicks off the
      decode of *i+1* concurrently, `clearRect`s and `drawImage`s each `VideoFrame` then
      `close()`s it immediately, counts loops against `repetitionCount + 1` (research R7),
      touches the registry session on every frame, and **pins on `start()` / unpins on
      `stop()`** so an actively playing post is not merely recently-used but structurally
      ineligible for eviction (research R9). Keep each method under 50 lines — split the
      frame step into small private methods rather than one long loop body.

### Visibility and glue hooks

- [X] T009 [P] Write failing tests in `frontend/tests/hooks/useInViewport.test.tsx` following
      the captured-mock-observer pattern of the existing
      `frontend/tests/hooks/useVideoAutoplay.test.tsx`: `isVisible` true when
      `intersectionRatio >= 0.5` (test (a), the same constant video uses); `isVisible` true
      when `intersectionRect.height >= rootBounds.height / 2` at a ratio well *below* 0.5
      (test (b), the tall-meme case — FR-011); `isVisible` false when intersecting but
      failing both; falling back to `window.innerHeight` when `rootBounds` is `null`; the
      threshold ladder is fine-grained enough that test (b) can fire (research R5);
      `isNear` driven by the second observer with `rootMargin: '100% 0px'`; both observers
      `disconnect()`ed on unmount and re-created when the `node` argument changes (the
      `<img>` → `<canvas>` swap); **`node === null` constructs zero `IntersectionObserver`s**
      (not "observes nothing" — assert the constructor spy was never called, since this is
      the mechanism that keeps a JPEG feed free, research R5).
      **Pin the FR-004 asymmetry here**: at a ratio that falls from 0.6 to 0.3 with
      `isIntersecting` still true, `isVisible` goes **false** — deliberately unlike
      `useVideoAutoplay`, which acts on `isIntersecting` alone and would keep playing.
      Comment the test with the reason (research R5) so a future reader does not "fix" it
      into parity.
- [X] T010 Implement `useInViewport(node)` in `frontend/src/hooks/useInViewport.ts` returning
      `{ isVisible, isNear }` to the contract, making T009 pass — two IntersectionObservers,
      the FR-011 dual test, and the `THRESHOLD_LADDER` (`0, 0.02 … 1.0`) constant with a
      comment explaining *why* the ladder exists (research R5: IO only fires at declared
      thresholds, and test (b) flips at a ratio near 0.17 for a three-screen-tall meme).
      Return early — constructing **no** observers — while `node` is `null`, which is how a
      non-candidate post pays nothing (research R5). A second comment records that evaluating
      the ratio (rather than `isIntersecting`) is what makes the image stop earlier than a
      video, and that this is intended (FR-004).
      **Do not touch `frontend/src/hooks/useVideoAutoplay.ts`** (FR-004a, SC-010).
- [X] T011 Write failing tests in `frontend/tests/hooks/useAnimatedImage.test.tsx` covering
      the behavior table in contracts §`hooks/useAnimatedImage.ts`: no probe,
      `takeover === null` forever **and zero `IntersectionObserver` constructions** when
      `AnimatedImage.isSupported()` is false (FR-012, SC-009); the same — no probe, **zero
      fetches, zero observers** — for a `.jpg`/`.png` src (FR-008, SC-007); a single probe
      when `isNear` first becomes true, never repeated on later `isNear` flips;
      a still-image probe result marks the post static permanently (no retry, no canvas);
      a successful probe sets `takeover` to the frame's intrinsic `{ width, height }`;
      `isVisible` true ⇒ player `start()` and `isPlaying` true; `isVisible` false ⇒ `stop()`
      with the position persisted; unmount ⇒ `stop()`, observers disconnected and the
      `visibilitychange` listener removed, while the session stays cached (research R9).
      **The probe URL (research R4)**: with an `<img>` whose `currentSrc` is a *different*
      srcset variant than `media.src`, the fetch and the registry key are `currentSrc`, not
      `media.src`; with `currentSrc` still `''` (lazy image not yet loading) **no probe is
      issued**, and it fires on the img's subsequent `load` event.
      **Hidden page (FR-002a, SC-012, research R16)**: `isVisible` true while
      `document.hidden` is stubbed true ⇒ no `start()`; dispatching `visibilitychange` after
      hiding a playing post ⇒ `stop()` with the position persisted; unhiding while still
      visible ⇒ `start()` resuming on the held frame, never frame 0.
      Call `AnimationRegistry.reset()` between cases.
- [X] T012 Implement `useAnimatedImage(src)` in `frontend/src/hooks/useAnimatedImage.ts`
      returning `{ setNode, takeover, isPlaying }` to the contract, making T011 pass — the
      callback ref shared by both `<img>` and `<canvas>`, `useInViewport` (T010) for the two
      visibility signals, `AnimationRegistry` (T006) for acquisition, `AnimationPlayer`
      (T008) for playback, and a `useLayoutEffect` that draws the first decoded frame before
      the browser paints the swapped-in canvas (research R8 mechanic 1, SC-008). `takeover`
      is one-way — once set it is never cleared (research R8 mechanic 2, data-model.md §4).
      Three things the contract now pins down, all easy to get wrong:
      - **Gate before observing.** Evaluate `AnimatedImage.isSupported()` and
        `isCandidate(src)` first and pass `null` to `useInViewport` when either fails, so a
        JPEG post and every post on Safari construct no observers at all (research R5).
      - **Probe `currentSrc`, not `src`.** The fetched/keyed URL is
        `(node as HTMLImageElement).currentSrc`; `src` only feeds `isCandidate`. Defer the
        probe while `currentSrc` is `''` and re-check on the img's `load` event (research R4).
      - **Hidden page freezes.** Subscribe once to `visibilitychange` and drive playback
        from `isVisible && !document.hidden`, so a backgrounded tab stops instead of
        advancing frames on throttled timers (FR-002a, research R16).

**Checkpoint**: `npm test` green with the five new modules covered; no visitor-visible change
yet — `MemeMedia` still renders today's `<img>`.

---

## Phase 3: User Story 1 - Only the animated images I'm actually looking at are moving (Priority: P1) 🎯 MVP

**Goal**: In the feed, an animated GIF/WebP post starts animating as it scrolls into view
and freezes on its current frame as it scrolls out, resuming from that exact frame on the
way back — starting on the same half-visible rule video already uses, and freezing on that
same boundary rather than waiting for full exit the way video does (FR-001/002/003/004/006).

**Independent Test**: Load a feed with ≥3 animated posts spread so only one is on screen at
a time; scroll slowly and confirm only on-screen ones move, each freezes on leave and
resumes (not restarts) on return; confirm an animated GIF and an animated WebP are
indistinguishable in that behavior (quickstart Scenarios 1–2).

- [X] T013 [P] [US1] Write failing tests in `frontend/tests/components/MemeImage.test.tsx`
      for the DOM contract in contracts §"DOM contract": before takeover the markup is
      byte-for-byte today's `<img class="meme-media meme-media__image" src srcset sizes alt
      width height loading="lazy">`; after takeover the element is
      `<canvas class="meme-media meme-media__image meme-media__canvas" role="img"
      aria-label="<same alt text>" width height data-playing="true|false">`;
      `data-playing` reflects `isPlaying` and flips with visibility; the canvas `width`/
      `height` come from the decoded frame (FR-009); an `onError` on the pre-takeover `<img>`
      still degrades the post to `null` (existing behavior). Two additions:
      - **`--fluid` modifier**: a post whose media has a non-empty `srcset` takes over to a
        canvas carrying `meme-media__canvas--fluid`; one whose `srcset` is `''` does **not**.
        This is the whole of the layout-shift defence (research R8 mechanic 3), so assert
        both directions, and assert it holds when the decoded frame is *narrower* than the
        post's stored `media.width` (the small-variant case that would otherwise shrink the
        post by half).
      - **No new chrome (FR-013)**: the taken-over subtree contains exactly one element —
        no `<button>`, no overlay, no control of any kind.
- [X] T014 [US1] Implement `MemeImage` in `frontend/src/components/MemeImage.tsx` — the image
      branch extracted out of `MemeMedia`: `useAnimatedImage(media.src)` (T012), the
      `<img>` ⇄ `<canvas>` render fork on `takeover`, the `isBroken` state moved across
      unchanged, and the optional `linkTo` permalink wrapper around **both** forms. Props
      mirror what the image branch of `MemeMedia` receives today —
      `{ media: ImageFeedMedia; linkTo?: string }`, where `ImageFeedMedia` is a new
      `Extract<FeedMedia, { kind: 'image' }>` alias declared alongside the existing
      `VideoFeedMedia` / `YoutubeFeedMedia` (`MemeMedia.tsx:9-10`) and exported for
      `MemeImage` to import. Apply `meme-media__canvas--fluid` iff `media.srcset !== ''`
      (T002, research R8 mechanic 3).
- [X] T015 [US1] Edit `frontend/src/components/MemeMedia.tsx` so the `media.kind === 'image'`
      branch delegates to `<MemeImage media={media} linkTo={linkTo} />`, removing the now-
      duplicated `<img>`/`isBroken`/`<Link>` code from that file. **`YoutubeMedia`,
      `VideoMedia`, `VideoControls` and every video handler stay untouched** (FR-004a).
- [X] T016 [US1] Update `frontend/tests/components/MemeMedia.test.tsx` for the delegation:
      the image branch's existing assertions must still pass through `MemeImage` (same
      classes, `src`/`srcset`/`sizes`/`alt`/`width`/`height`/`loading`, the
      `meme-media__link` wrapper when `linkTo` is given, broken-image degradation), and the
      YouTube/video branches keep their current assertions verbatim.
- [X] T017 [US1] Wire the real feed path end-to-end in `frontend/tests/components/FeedItem.test.tsx`:
      a feed entry whose media is an animated `.gif`/`.webp` renders through `MemeImage` and
      takes over, while entries around it are unaffected — FR-005's "wherever these memes are
      shown", feed half. Add the case rather than rewriting existing FeedItem assertions.

**Checkpoint**: US1 is independently demoable — quickstart Scenarios 1, 2 and 3 step 1–2 pass
in Chrome against the dev stack.

---

## Phase 4: User Story 2 - An animated image on its own page behaves the same (Priority: P2)

**Goal**: The permalink page gets the identical behavior, with the media unwrapped (no
permalink `<Link>` around it) as it is today (FR-005, US2 scenarios 1–2).

**Independent Test**: Open an animated meme's `/posts/{hash}` directly, confirm it animates
on arrival, scroll down into the comments until it leaves the viewport, confirm it stops,
scroll back and confirm it resumes on the frozen frame (quickstart Scenario 8).

- [X] T018 [P] [US2] Write failing tests in `frontend/tests/pages/PostPage.test.tsx` for the
      permalink path: an animated image post renders through `MemeImage` with **no**
      `meme-media__link` wrapper (`linkTo` is not passed on this page), takes over to a
      canvas, and carries `data-playing` — while a static image post on the same page still
      renders a bare `<img>` and is never probed.
- [X] T019 [US2] Confirm T018 passes with **no production change** to
      `frontend/src/pages/PostPage.tsx` — the page already renders `MemeMedia` without
      `linkTo`, which T015 routed to `MemeImage`, so US2 should fall out of US1 for free.
      If it does not, make the smallest fix in the image branch only and leave the page's
      video/YouTube/comments rendering untouched. Either way record which outcome applied in
      the commit message; "no change needed" is the expected and successful result here.

**Checkpoint**: US1 and US2 both work; feed and permalink share one implementation.

---

## Phase 5: User Story 3 - Nothing else about the post changes (Priority: P3)

**Goal**: Prove by test that the surrounding post experience is untouched — frozen frame
looks like the meme, permalink click still navigates, alt text survives the swap, static
images and video posts are entirely unaffected (FR-008/009/010, SC-003/007/010).

**Independent Test**: With a stopped animated post, confirm the visible frame is recognisably
the meme; click it in the feed and confirm it opens the permalink; confirm a static JPEG/PNG
post and a video post in the same feed behave exactly as before (quickstart Scenario 5).

- [X] T020 [P] [US3] Add static-image regression tests to
      `frontend/tests/components/MemeImage.test.tsx`: a `.jpg`, a `.png`, a **single-frame**
      `.gif` and a **single-frame** `.webp` each stay a plain `<img>` forever — no canvas, no
      `data-playing`, no class change — and `fetch` is called **zero** times for the JPEG/PNG
      (pre-filter) and exactly once, with no takeover, for the single-frame files
      (FR-008, SC-007, quickstart Scenario 5 step 2). Also assert the JPEG/PNG cases
      construct **zero `IntersectionObserver`s** — the cost half of FR-008 that a
      fetch-count assertion alone would miss on a 200-entry feed (research R5).
- [X] T021 [US3] Add preservation tests to `frontend/tests/components/MemeImage.test.tsx`
      (same file as T020 — sequence them, not `[P]`):
      after takeover the `<canvas>` is still wrapped in
      `<Link class="meme-media__link" tabIndex={-1}>` pointing at the same permalink and a
      click navigates (US3 scenario 2, FR-010); the canvas's accessible name equals the
      `<img>`'s `alt` via `role="img"` + `aria-label` (FR-010, Principle IV); the rendered
      box keeps the media's aspect ratio in both states (FR-009), including when the decoded
      frame's dimensions differ from `media.width`/`media.height` — the canvas attributes
      carry the frame's ratio while `--fluid` carries the width, and neither may drift from
      the `<img>`'s ratio (research R8 mechanic 3).
- [X] T022 [P] [US3] Add a video/YouTube non-regression guard to
      `frontend/tests/components/MemeMedia.test.tsx`: a video post still renders a real
      `<video class="meme-media__video">` (never a canvas) with its controls and
      `useVideoAutoplay` wiring, and a YouTube post still renders the sandboxed `<iframe>` —
      pinning SC-010. Pair it with `git diff --stat` evidence that
      `frontend/src/hooks/useVideoAutoplay.ts` has **zero** changed lines on this branch
      (FR-004a).
- [X] T023 [US3] Add flick-scroll / one-swap-ever coverage to
      `frontend/tests/hooks/useAnimatedImage.test.tsx`: rapid `isVisible` true→false→true
      cycles produce **no** second element swap and no re-probe (`takeover` is one-way,
      research R8 mechanic 2, SC-008), and a post whose session was evicted mid-cycle
      re-acquires and resumes on its saved frame with the canvas never cleared to blank
      (FR-019, SC-011). Make the re-acquire case the **SC-002 proxy**, since the 0.5 s budget
      has no other automated check: assert the scroll-back path issues exactly **one** fetch
      (cache-hit, no re-probe of a known-animated URL), draws the saved frame in the first
      layout effect after re-acquisition, and paints nothing blank in between — i.e. the
      work between "scrolled back" and "showing the right frame" is one cached request and
      one decode, not a re-run of the whole probe.

**Checkpoint**: All three stories independently functional and covered by unit tests.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Write `frontend/tests/e2e/animated-image.spec.ts` (chromium-only project),
      modeled on `frontend/tests/e2e/video-playback.spec.ts` and reusing its
      `helpers/e2eReset`, `helpers/adminSetup` and `helpers/mailLog` flow: register → verify
      → upload `backend/tests/fixtures/animated.gif` (T001) and
      `backend/tests/fixtures/animated.webp` → activate → assert on **both** the feed and the
      permalink that the element is a `canvas.meme-media__canvas`, that
      `data-playing="true"` while in view, `"false"` after scrolling away, and `"true"` again
      on scroll-back (research R12, SC-006).
- [X] T025 Run the real frontend gates and fix what they report:
      `docker compose run --rm frontend npm run lint` and
      `docker compose run --rm frontend npm test -- --coverage` — ESLint clean and the ≥90%
      line gate green **over all of `src/`**, including the five new modules and `MemeImage`
      (Principle VII). Paste real output; do not claim green without it.
- [X] T026 Run the e2e stack once — `scripts\e2e.ps1` — and confirm
      `animated-image.spec.ts` passes alongside the existing specs (especially
      `video-playback.spec.ts`, which must be untouched and still green — SC-010).
      **Result: 41 passed, 1 skipped (`logo-parity`, pre-existing), 1 failed.** Both specs
      this task names are green. The failure is `upload.spec.ts:85`, which asserts a pending
      upload shows its owner **no** image — behaviour master changed on 2026-07-21
      (`4c44336` owner-visible pending posts + `874a9ce` the HiddenNotice banner) without
      updating the assertion. Stale on master, unrelated to this feature: nothing on this
      branch touches `PostPage`, `HiddenNotice` or any backend visibility rule.
- [X] T027 [P] Verify the dependency invariant: `git diff master -- frontend/package.json
      frontend/package-lock.json backend/composer.json backend/composer.lock` is **empty**
      (FR-015, Principle I, SC-009's "0 new third-party dependencies"), and `git diff --stat
      master -- backend/app backend/database backend/routes backend/tests` shows only the
      T001 fixture (FR-014).
- [ ] T028 Walk quickstart.md Scenarios 1–12 manually against the dev stack in Chrome, plus
      Scenario 6 in Safari **or** with `ImageDecoder` deleted before load (the FR-012
      fallback), Scenario 4 at ~360×640 for the tall-meme rule, and Scenario 9's explicit
      **color-fidelity side-by-side** (research R13 — the one flagged risk; if a shift
      appears the local fix is `createImageBitmap(frame)` before drawing, which changes no
      interface). Four of these are the only coverage their requirement gets, so none may be
      skipped: **Scenario 3 step 3** (image freezes earlier than video — the accepted FR-004
      asymmetry, confirm it looks deliberate rather than broken), **Scenario 5 step 3** at a
      narrow window (no width change on takeover with a small `srcset` variant — FR-009),
      **Scenario 11** (a meme that predates this branch, using no fresh upload — FR-007,
      SC-005), and **Scenario 12** (backgrounded tab holds its frame — FR-002a, SC-012).
      Record the result of each scenario.
      **DONE, with two bugs found and fixed (see T031/T032) and one doc error corrected
      (T033).** Run in Chrome against the dev stack at a 2560×1249 viewport. Subjects: the
      library's own pre-existing GIFs, plus five uploads by `qa021@example.com` —
      `8RGAEFqrZP` (animated WebP), `bsCDIpUPlD` (hand-built 6-frame **play-once** GIF, no
      NETSCAPE block, `repetitionCount: 0` — the library had none), `vrAkwIDOKw` +
      `BmQbHMhMyN` (two infinite-loop GIFs, for the both-at-once case) and `fkuNW2ophC`
      (300×2800 looping GIF — the library's only >1400 px GIF turned out to be single-frame).

      | Scenario | Result |
      | --- | --- |
      | 1 — only what's on screen moves | **PASS.** 10 away/return cycles on `cz2tANp8El`: frozen every time, frame held while away, playing on return. Resume checked by decoded frame INDEX, not timing — froze at 24/37/51/4/21/40 and resumed on that exact frame, never frame 0 (FR-003, SC-004). Step 5: two looping GIFs both covered 1.0 both played, 4 distinct frames each — no single winner. |
      | 2 — GIF and WebP alike | **PASS.** Both take over and run the identical play/freeze/resume cycle; T024 asserts one shared assertion set over both. |
      | 3 — same rule as video | **PASS, but the spec's step 3 was wrong** — see T033. Image played at 85% covered, froze at 45%; video played at 70%, paused at 45%. Same boundary, no "image stops earlier" asymmetry. Video still a real `<video>`. |
      | 4 — meme taller than the screen | **PASS.** `fkuNW2ophC` renders 2800 px in a 1249 px window, so ratio can never reach 0.5 (max seen 0.446) — it played throughout on the tall-meme rule alone, and froze only once the visible slice fell under half the window (ratio 0.164, 0.74 of half-window). FR-011 verified in both directions. |
      | 5 — nothing else changed | **PASS after fixing T031.** Zero layout shifts recorded (PerformanceObserver, `buffered: true`) and the element's box never changed size through takeover. Full-feed walk: **zero** `/storage/` probe fetches for any non-GIF/WebP post; JPEGs stayed `<img>`; static WebPs probed once and stayed `<img>` (FR-008). Flick-scroll 8× — same canvas element, same size, still playing (SC-008). Accessible name = alt via `role="img"` + `aria-label`. |
      | 6 — fallback path | **PASS.** With `ImageDecoder` deleted and every post remounted: 0 canvases, 0 broken images, **0 probe fetches**, no per-post observers (SC-009, FR-012). |
      | 7 — deep feed, bounded memory | **PASS.** Scrolled 160 posts / 33 animated canvases — far past the LRU(12) cap — then returned to an early post: exact frozen frame restored, never blank, ready in **168 ms** (FR-019, SC-011, and well inside SC-002's 0.5 s). |
      | 8 — permalink page | **PASS** for takeover + play; the freeze half is covered by T024 at a 480×300 viewport. At the dev window's 1249 px height most permalinks do not scroll at all (`maxScroll: 0`), so the freeze cannot be provoked there. |
      | 9 — repeat settings and fidelity | **PASS after fixing T032.** Play-once GIF plays through once and rests on its **final** frame; scrolling away and back grants no second play. **Colour fidelity (research R13, the one flagged risk): RESOLVED** — ImageDecoder frames compared pixel-for-pixel against `createImageBitmap` of the same bytes give `maxChannelDelta: 0`, `differingPct: 0`, `alphaMismatchPct: 0` across GIF, animated WebP and transparency-carrying GIFs. No `createImageBitmap` workaround needed. |
      | 10 — theme and responsive | **PARTIAL.** The canvas is media, not chrome, and carries no theme-dependent styling. Breakpoint sweep NOT done: `resize_window` is ignored on the maximised window, so 360 px / tablet widths were unreachable. |
      | 11 — a meme predating the feature | **PASS.** All of scenario 1 above ran on `cz2tANp8El`, an untouched library GIF, served from its original `/storage/…` URL; the probe reuses the variant the `<img>` selected (FR-007, SC-005). |
      | 12 — backgrounded tab | **PARTIAL.** Could not background a tab through the automation (a new tab does not deactivate the old one; `ctrl+2` does not reach browser chrome). Real evidence available: while the window was genuinely occluded, `document.hidden` was true, the play-once GIF never started and consumed no part of its single run, then played its full run when the window came back — Scenario 12 step 3's expectation. The note-frame/hide/return comparison is unit-covered only. |

- [X] T029 [P] Update `C:\projects\ladybug\CLAUDE.md` — add the **021-gif-viewport-autoplay**
      entry to the implemented-features list (frontend-only; `ImageDecoder` takeover with
      LRU(12) sessions + page-lifetime frame positions; Safari/iOS keeps the always-animating
      fallback; video deliberately untouched) and bump the "Current State (as of …)" date and
      feature count.
- [X] T030 **Cross-origin media in dev and e2e** (discovered during T024, not in the original
      plan). research.md R4 asserts "media is same-origin … so no CORS work"; that holds in
      **production**, where one nginx server block serves both the SPA and `/storage/`, but
      **not** in dev (SPA `:5173`, media `:8000`) or e2e (`:5174` / `:8001`). Without an
      `Access-Control-Allow-Origin` header the probe's `fetch` is blocked — measured in
      Chrome: `mode:'no-cors'` returns an opaque response, `mode:'cors'` throws — so
      `AnimatedImage.probe` resolves `null` and the takeover silently never happened outside
      production, indistinguishable from FR-012's intended fallback. Fixed by serving the
      header on `/storage/` in `docker/nginx-dev/default.conf`, and by giving the e2e stack
      the same nginx front it never had (`docker/nginx-e2e/default.conf` + an `nginx-e2e`
      service owning `:8001`, backend-e2e now internal). **No production or application code
      changed — this is dev/e2e topology only**, and research.md R4 now carries the
      correction inline.
- [X] T031 **The canvas upscaled every animated post** (found in T028, reported by the human
      as "why is the gif upscaled?"). `--fluid` set `width: 100%`, on the premise (research R8
      mechanic 3) that a w-descriptor `<img>` lays out at its `sizes` width. It does not:
      `MemeImage` sets the `width`/`height` **attributes**, which are presentational hints
      setting CSS `width`, and those beat srcset density correction. Measured on the dev feed —
      every static `<img>` renders at exactly its width attribute (500→500, 700→700, 800→800,
      1280→capped 1246), while both taken-over canvases rendered 1246. A 120 px GIF was blown
      up **10×**, and theme.css:386 states the site's explicit "never upscale" rule. This also
      meant a size change at the swap, the exact thing FR-009/SC-003 forbid. Fixed by passing
      the post's own width as `--meme-media-width` (the `--video-progress` inline
      custom-property pattern) and deleting `--fluid`. Verified after: canvases render 120×120
      / 400×200 / 64×64, matching the `<img>`, with **zero** layout shifts recorded.
- [X] T032 **`data-playing` stayed "true" after a play-once file finished** (found in T028).
      `useAnimatedImage` only read `player.isPlaying` right after driving `start()`/`stop()`
      itself, but `AnimationPlayer` also stops **itself** when a finite `repetitionCount` runs
      out (FR-003a). Observed in Chrome: the play-once GIF correctly came to rest on its final
      frame, not advancing, while `data-playing` still said `"true"` — and `data-playing` is
      the only externally observable playback signal, the one T024 asserts on. Fixed with an
      `onStateChange` callback the player fires on every real transition (idempotent calls
      excluded); the hook sets its state from it. Both new player tests and the hook test were
      confirmed to FAIL against the unfixed player before the fix landed.
- [X] T033 **The FR-004 "asymmetry" does not exist** (found in T028). research R5, quickstart
      Scenario 3 step 3, `useInViewport.ts`'s comment and its test's comment all claimed video
      keeps playing until full exit because it "branches on `isIntersecting` alone". A declared
      threshold *does* gate `isIntersecting`: measured directly in Chrome, an observer with
      `threshold: 0.5` reports `false` at ratio 0.25 and `true` at 0.75. Video therefore pauses
      on the same half-visible boundary an image freezes on. The genuine divergence is the
      tall-meme rule and it runs the other way — an image taller than twice the window keeps
      playing where a video would pause, i.e. more forgiving, not less. Comments and both spec
      documents corrected; **no code change** — the implementation was always right, only its
      description was wrong.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — T001 and T002 can start immediately and in parallel.
- **Foundational (Phase 2)**: T002 is not strictly blocking but should land first so the
  canvas never renders unstyled. **Blocks all user stories.**
- **US1 (Phase 3)**: depends on Phase 2 complete (needs `useAnimatedImage` → all three `lib/`
  classes and `useInViewport`).
- **US2 (Phase 4)**: depends on Phase 2; in practice T015 (US1) already routes the permalink
  page through `MemeImage`, so run US2 after US1 for a single-change-point delivery.
- **US3 (Phase 5)**: depends on T014/T015 existing (its tests assert against them). It adds
  **no production code** — it is the regression net.
- **Polish (Phase 6)**: T024/T026 need T001 + US1; T025/T027 need all code phases; T028 needs
  a running stack with everything merged.

### Within Phase 2 (foundational chain)

```
T003 ─▶ T004 ─┐
T005 ─────────┴─▶ T006 ─┐
T007 ───────────────────┴─▶ T008 ─┐
T009 ─▶ T010 ─────────────────────┤
T011 ─────────────────────────────┴─▶ T012
```

- T004 requires T003 (its tests).
- T006 requires T005 + T004 (`AnimationRegistry.acquire` delegates to `AnimatedImage.probe`).
- T008 requires T007 + T006 + T004 (player reads sessions and the delay clamp).
- T012 requires T011 + T010 + T008.

### Within Each User Story

- Test task first, and it MUST fail before the implementation task starts (TDD, Principle VII).
- Component before the file that delegates to it (T014 before T015).
- Story complete and its checkpoint verified before moving to the next priority.

### Parallel Opportunities

- **Phase 1**: T001 ∥ T002 (different stacks entirely).
- **Phase 2**: the four independent test-authoring tasks T003 ∥ T005 ∥ T007 ∥ T009 (four
  different files, no shared state). Implementations then follow the chain above.
- **Phase 3**: T013 is standalone; T016 and T017 touch different test files and can run in
  parallel once T015 lands.
- **Phase 5**: T022 ∥ T023 (different files) and either of them ∥ the T020→T021 pair.
  T020 and T021 both edit `MemeImage.test.tsx`, so they run **in sequence** — `[P]` in this
  document means "different files", with no exceptions.
- **Phase 6**: T024 ∥ T027 ∥ T029; T025/T026/T028 are serial gates.
- Across stories: US2 and US3 could be worked in parallel by different people once US1 lands.

---

## Parallel Example: Phase 2 test authoring

```bash
# Four failing-test files, no shared state — write them together:
Task: "Unit tests for AnimatedImage in frontend/tests/lib/animatedImage.test.ts"
Task: "Unit tests for AnimationRegistry in frontend/tests/lib/animationRegistry.test.ts"
Task: "Unit tests for AnimationPlayer in frontend/tests/lib/animationPlayer.test.ts"
Task: "Tests for useInViewport in frontend/tests/hooks/useInViewport.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (T001–T002).
2. Phase 2 Foundational (T003–T012) — **critical path, blocks everything**.
3. Phase 3 US1 (T013–T017).
4. **STOP and VALIDATE**: quickstart Scenarios 1–3 in Chrome; confirm a video post is
   unchanged before going further.
5. Demoable: the feed behaves as the request describes.

### Incremental Delivery

1. Setup + Foundational → nothing visitor-visible, everything unit-covered.
2. + US1 → feed autoplay/freeze/resume (MVP).
3. + US2 → permalink page parity.
4. + US3 → regression net proving nothing else moved.
5. + Polish → e2e, real CI gates, manual quickstart pass, docs.

### Risk Notes

- **The one flagged unknown is color fidelity** (research R13) — deliberately validated in
  T028 rather than assumed; the fix is local and interface-preserving.
- **The accepted cosmetic limitation** (research R8): a post already on screen at page load
  animates as an `<img>` for a few hundred ms, then the canvas starts it at frame 0. Known,
  documented, one-time, and outside FR-003 (which governs resume *after leaving*). Do not
  spend tasks engineering it away.
- **Safari/iOS (~22% of visitors) never enters the enhanced path.** That is FR-012 working
  as designed, not a bug — T028's Scenario 6 confirms it looks exactly like today.

---

## Notes

- Tests are mandatory here (Principle VII), not optional: the CI gate is ≥90% lines over
  **all** of `frontend/src/`, so an uncovered new module fails the build.
- `[P]` = different files, no dependency on an incomplete task.
- Commit after each task or logical group; dispatch the `commit-quality-verifier` agent
  before each phase commit and commit only on PASS (project convention).
- Backend PHP is not involved — no `php artisan`, no migration, no backend test run needed
  for this feature beyond leaving it untouched (verified by T027).
