# Implementation Plan: Animated Image Viewport Autoplay

**Branch**: `021-gif-viewport-autoplay` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-gif-viewport-autoplay/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Give animated GIF and animated WebP memes the same start-on-scroll-in / stop-on-scroll-out
behavior video posts already have, with frame-accurate resume. Because no platform API can
freeze an `<img>` mid-animation and pick it back up, the frontend **takes the animation
over from the `<img>`**: the browser's own WebCodecs `ImageDecoder` (a platform API — no
new dependency, FR-015) decodes the file the browser already downloaded, and a `<canvas>`
that replaces the `<img>` is driven frame by frame from our own timer. Stopping is simply
"don't schedule the next frame", so the remembered frame index *is* the resume point
(FR-003), and off-screen time cannot consume a file's finite play-through allowance
(FR-003a).

Everything is discovered in the browser: whether a post is animated comes from the decoded
track, never from a stored flag or an API field (FR-016), which is why every meme
published before this feature works untouched (FR-007). Where `ImageDecoder` is missing —
notably **all of Safari/iOS today, ~22% of visitors** — nothing is taken over and the
`<img>` keeps animating exactly as it does now (FR-012).

Visibility uses the same half-visible constant video uses, so the two media types *start*
together (FR-004); they stop apart, because the existing video hook branches on
`isIntersecting` alone and so pauses only on full exit — a documented asymmetry we do not
copy and do not fix here (research R5, FR-004a). On top of that sits one addition only a
meme taller than the screen can reach: it also animates once its visible part covers half
the screen height (FR-011). Video code is not touched at all (FR-004a). A hidden tab
freezes too, since our own timer would otherwise keep limping along where the `<img>`'s
animation used to be suspended by the platform (FR-002a, research R16).
Playback resources are capped at the 12 most-recently-used posts (FR-017) while the
remembered frame position — a few numbers per post — is kept for every post on the page
(FR-018), so a released post resumes rather than restarts (FR-019).

**This is a frontend-only feature.** `backend/` is not modified: no migration, no API
field, no new endpoint, no change to any public URL (FR-014).

## Technical Context

**Language/Version**: TypeScript (React 18 + Vite) — frontend only. No PHP change.

**Primary Dependencies**: Existing stack only (React 18, React Router). **No new npm or
Composer package and no new system binary** — the feature is built on the platform's
`ImageDecoder`, `IntersectionObserver`, `<canvas>`, `fetch` and `setTimeout`
(research.md R1/R14, FR-015).

**Storage**: None. No database change, no new stored media, no new file variant — the
existing animated variants (gifsicle for GIF, ImageMagick for animated WebP, both already
animation-preserving) are decoded as served (research.md R12).

**Testing**: Vitest + jsdom (≥90% line gate over all of `src/`) with stubbed
`ImageDecoder` / `IntersectionObserver` / canvas context, plus one Playwright spec on the
chromium-only e2e stack (research.md R11/R12). No new test tooling.

**Target Platform**: Web SPA. Enhanced path: Chrome/Edge 94+, Firefox 133+ (~78% of
visitors). Fallback path (today's behavior, unchanged): Safari macOS/iOS and anything else
lacking `ImageDecoder`.

**Project Type**: Web application (existing `backend/` + `frontend/` split); only
`frontend/` is touched.

**Performance Goals**: Start/resume within 0.5 s of entering view (SC-002); zero layout
shift (SC-003); at most 12 live decoders at any moment regardless of scroll depth
(SC-011); frame pacing matching native GIF playback, including the legacy `<20 ms ⇒ 100 ms`
delay clamp (research.md R6).

**Constraints**: No new visible chrome — no play/pause control, no overlay (FR-013); the
`<img>`'s permalink click target, alt text and box size must survive the swap
(FR-009/FR-010 — and the box needs the `srcset` density-correction equivalent, not just the
`img` reset, research.md R8 mechanic 3); video behavior must be provably untouched
(FR-004a/SC-010); no second download of the media bytes (`cache: 'force-cache'` against
`img.currentSrc` — the variant actually selected, never `media.src`, and deferred until the
element has selected one, research.md R4).

**Scale/Scope**: Six new frontend modules (3 `lib/` classes, 2 hooks, 1 component), two
edited files (`MemeMedia.tsx`, `theme.css` — one canvas rule, sized by `--meme-media-width`),
one new e2e fixture. No new route, no new page, no backend file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies | PASS | Zero new npm/Composer/system dependencies; `package.json` untouched. The frame-accurate resume requirement is met with the platform's `ImageDecoder`, and where that is absent the answer is the FR-012 fallback, explicitly **not** a decoder package (research.md R1/R2/R14). |
| II. Coding Conventions | PASS | New TS is 2-space, semicolons, `PascalCase` classes/components, `is`-prefixed booleans (`isSupported`, `isPlaying`, `isVisible`, `isFinished`), one class per `lib/` module called through the class. Every function stays under 50 lines — which is *why* the work is split across `AnimatedImage` / `AnimationRegistry` / `AnimationPlayer` / two hooks / `MemeImage` rather than living in one component (research.md R15). `AnimationPlayer` is an instance class (per-post mutable state); documented in research.md R15 so it does not read as a slip. |
| III. Browser-Native Navigation | PASS | No routing, URL, paging or scroll-restoration change. Playback state is deliberately page-lifetime only, so Back/Forward/Refresh restore exactly what they do today (data-model.md invariant 5); the feed's 10-at-a-time / 200-entry break is untouched. |
| IV. Theme & Accessibility | PASS | The `<canvas>` carries `role="img"` + `aria-label` with the same alt text the `<img>` had, so the text alternative survives the swap (FR-010, contracts). No color-only signal is introduced — the only new attribute is the invisible `data-playing` hook for tests. Reduced-motion is explicitly out of scope per spec Assumptions (it would be a site-wide policy covering video equally). |
| V. Stable Meme Identifiers | PASS | No identifier change. The client-side registry keys on the media URL, not the post `hash`, and adds no new public identifier. |
| VI. Security & Input Validation | PASS | No new server input, no new endpoint, no user-supplied string reaching the DOM. The only new request is a same-origin `GET` of a media URL that came from the API response and was already loaded by the `<img>` — never a URL built from user text. Nothing is injected as HTML; the canvas renders decoded pixels. Upload validation is entirely unchanged (FR-014). |
| VII. Test Coverage & Organization | PASS | Six new mirrored test files under `frontend/tests/` matching source paths exactly, plus updates to `MemeMedia.test.tsx` and one e2e spec (quickstart.md "Automated coverage"). The module split exists partly so the decode/LRU/pacing logic is testable without a browser (research.md R11). Edge cases from the spec — single-frame files, evicted posts, finite repeat counts, missing `ImageDecoder`, decode failure — each map to a named test. |
| VIII. Responsive, Multi-Device Layout | PASS | The canvas replicates the global `img` reset (`max-width:100%; height:auto; display:block; margin-inline:auto`) **plus a `--fluid` modifier standing in for the `srcset` density correction a canvas does not get** (research R8 mechanic 3), so it reflows identically at every breakpoint — including the narrow viewports where the browser picks a small variant; FR-011's second test exists precisely so a tall meme on a small screen behaves correctly. Verified across ~360px / tablet / desktop in quickstart.md Scenario 10, and note the fallback path is what most *iOS* visitors get today (research.md R2). |

No unjustified violations — Complexity Tracking is empty (see below).

**Post-Phase-1 re-check**: unchanged. The Phase 1 design added no dependency, no server
surface, no stored state, and no new visible control; the only new DOM attribute is
non-visual. All eight principles still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/021-gif-viewport-autoplay/
├── plan.md                        # This file (/speckit-plan command output)
├── research.md                    # Phase 0 output (/speckit-plan command)
├── data-model.md                  # Phase 1 output (/speckit-plan command)
├── quickstart.md                  # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── frontend-playback.md       # Phase 1 output — module + DOM contracts (no API change)
└── tasks.md                       # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing two-app layout. **`backend/` is not touched by this feature** (FR-014) — the one
backend-adjacent addition is a test fixture used by the frontend e2e upload flow.

```text
frontend/
├── src/
│   ├── lib/
│   │   ├── animatedImage.ts          # NEW — support gate, candidate filter, probe, delay clamp
│   │   ├── animationRegistry.ts      # NEW — LRU(12) sessions + page-lifetime frame positions
│   │   └── animationPlayer.ts        # NEW — one post's frame loop (instance class)
│   ├── hooks/
│   │   ├── useInViewport.ts          # NEW — FR-011 dual visibility test + acquisition margin
│   │   ├── useAnimatedImage.ts       # NEW — probe → takeover → play/freeze glue
│   │   └── useVideoAutoplay.ts       # UNCHANGED — video's rule stays exactly as-is (FR-004a)
│   ├── components/
│   │   ├── MemeImage.tsx             # NEW — <img> ⇄ <canvas>, broken state, permalink wrapper
│   │   └── MemeMedia.tsx             # EDIT — image branch delegates to MemeImage; video/YouTube untouched
│   └── styles/
│       └── theme.css                 # EDIT — .meme-media__canvas (img reset) + --fluid (density correction)
└── tests/
    ├── lib/
    │   ├── animatedImage.test.ts     # NEW
    │   ├── animationRegistry.test.ts # NEW
    │   └── animationPlayer.test.ts   # NEW
    ├── hooks/
    │   ├── useInViewport.test.tsx    # NEW
    │   └── useAnimatedImage.test.tsx # NEW
    ├── components/
    │   ├── MemeImage.test.tsx        # NEW
    │   └── MemeMedia.test.tsx        # EDIT — image branch now renders MemeImage
    └── e2e/
        └── animated-image.spec.ts    # NEW — chromium; mirrors video-playback.spec.ts

backend/
└── tests/fixtures/
    └── animated.gif                  # NEW fixture only (animated.webp already exists) — no app code
```

**Structure Decision**: The existing `frontend/` React+Vite app, extended in place. Both
places these memes are shown — the feed (`FeedItem` → `MemeMedia`) and the permalink page
(`PostPage` → `MemeMedia`) — already funnel through `MemeMedia`, so US1 and US2 are
satisfied at a single change point (FR-005). The work is split across six small modules
rather than one component because of the <50-line function rule (Principle II) and because
the decode/LRU/pacing logic must be unit-testable without a browser (Principle VII); the
DOM-facing surface stays a single component, `MemeImage`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.
