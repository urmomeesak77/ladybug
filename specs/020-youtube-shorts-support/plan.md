# Implementation Plan: YouTube Shorts Support

**Branch**: `020-youtube-shorts-support` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-youtube-shorts-support/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Widen the existing YouTube upload field to recognize `youtube.com/shorts/{id}` links
(currently rejected) by adding one more pattern to the shared id-extraction utility
(`Youtube::extractId` / `Youtube.toEmbedUrl`, kept in sync on both stacks) — a
Shorts-sourced post is then created, stored, and thumbnailed through the exact same
pathway as any other YouTube post. The one new piece of state is *orientation*: since
only the bare video id survives past validation, a new `youtube_is_short` boolean is
captured from the raw URL at upload time, stored on the post, and threaded through the
API so the feed and permalink can render a tall (9:16) player — centered, same card
width — instead of letterboxing it inside the existing wide (16:9) box.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript (React 18 + Vite) frontend — unchanged.

**Primary Dependencies**: Existing stack only (Laravel, Sanctum, React) — no new
runtime or system dependency (research.md R7).

**Storage**: MySQL via Eloquent — one new non-nullable `trashposts.youtube_is_short`
boolean column, default `false` (data-model.md). No new file storage; the existing
`YoutubeThumbnailService`/`img.youtube.com` thumbnail pathway is reused unchanged
(research.md R5).

**Testing**: PHPUnit (backend, ≥90% coverage gate), Vitest (frontend) — unchanged
toolchain; no new fixtures needed (URL strings only, no media files).

**Target Platform**: Web (existing responsive, themed SPA + JSON API) — unchanged.

**Project Type**: Web application (existing `backend/` + `frontend/` split) — unchanged.

**Performance Goals**: N/A beyond existing — a regex-array addition and one extra
boolean column add no measurable cost to upload or feed request paths.

**Constraints**: Detection is URL-shape-only, never a YouTube API call (spec
Assumptions); the surrounding feed card MUST keep the same width as a regular post's
card, with the vertical player centered inside it (resolved clarification, FR-006).

**Scale/Scope**: Small, surgical — one migration; one new regex pattern + one new
static method on the existing backend `Youtube` util (plus the matching pattern-only
mirror on the frontend util); one new field threaded through
controller → service → resource → `FeedModel` → `MemeMedia`; one new CSS modifier
class. No new subsystem, page, or route.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies | PASS | No new npm/Composer/system dependency (research.md R7). |
| II. Coding Conventions | PASS | New PHP stays PSR-12/4-space/<30-line methods (`Youtube::isShort()` is a 3-line method); new/changed TS stays 2-space, class-based helpers (`FeedModel`, `Youtube` already are), <50-line functions. |
| III. Browser-Native Navigation | PASS | No new routes or navigation model — Shorts posts use the same `/posts/{hash}` permalink and feed pagination as every other post. |
| IV. Theme & Accessibility | PASS | The `<iframe>`'s existing `title` attribute is unchanged; the vertical-vs-wide distinction is a layout/CSS change only, not a new color-only signal (Principle IV's "color is never the sole means" is untouched — orientation is conveyed by actual shape, not color). |
| V. Stable Meme Identifiers | PASS | No change to the `hash` scheme; a Shorts post gets a hash exactly like any other post. |
| VI. Security & Input Validation | PASS | The new `/shorts/{id}` pattern still yields only a re-validated 11-char id (never raw input stored/embedded); `youtube_is_short` is a derived boolean computed server-side from the already-validated input, never client-supplied directly (data-model.md). |
| VII. Test Coverage & Organization | PASS | New/changed logic gets mirrored tests in the existing files (research.md R6 table) — no new top-level test directories. |
| VIII. Responsive, Multi-Device Layout | PASS | The vertical player's CSS (`max-width: min(100%, 26rem)`) collapses to full card width on narrow viewports — no fixed single-width layout introduced (research.md R4); manual responsive check included in quickstart.md Scenario 5. |

No unjustified violations — Complexity Tracking is empty (see below).

## Project Structure

### Documentation (this feature)

```text
specs/020-youtube-shorts-support/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── api-posts.md      # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing two-app layout (`backend/` Laravel API + `frontend/` React/Vite SPA); this
feature only extends files already built for YouTube posts (008) — no new top-level
directories, no new components.

```text
backend/
├── app/
│   ├── Utils/
│   │   └── Youtube.php                         # add /shorts/ pattern + new isShort()
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── TrashpostsApiController.php     # store(): compute isShort from raw input, pass through
│   │   └── Resources/
│   │       └── TrashpostResource.php           # add `youtube_is_short` field
│   ├── Services/
│   │   └── TrashpostService.php                # createPost()/reserve(): thread + persist isShort
│   │   # YoutubeThumbnailService.php — unchanged (research.md R5)
├── database/migrations/
│   └── …_add_youtube_is_short_to_trashposts_table.php   # NEW
└── tests/
    ├── Unit/Utils/YoutubeTest.php                        # /shorts/ + isShort() cases
    ├── Feature/Http/Controllers/CreatePostTest.php        # Shorts accepted; word-only "shorts" still rejected
    └── Unit/Services/TrashpostServiceTest.php              # youtube_is_short persisted

frontend/
├── src/
│   ├── lib/
│   │   ├── youtube.ts          # add /shorts/ pattern (mirror only — see research.md R2)
│   │   └── feedModel.ts        # RawPost gains youtube_is_short; FeedMedia youtube variant gains isShort
│   ├── components/
│   │   └── MemeMedia.tsx       # YoutubeMedia: apply vertical modifier class when media.isShort
│   └── styles/
│       └── theme.css           # add .meme-media--video-vertical (9:16, capped width, centered)
└── tests/
    ├── lib/youtube.test.ts       # /shorts/ pattern case
    ├── lib/feedModel.test.ts     # isShort mapping
    └── components/MemeMedia.test.tsx   # vertical class applied only when isShort
```

**Structure Decision**: No new projects, directories, or components — this feature
extends the existing `backend/`+`frontend/` split exactly where feature 008
(image/YouTube upload) and its playback path already live. The only genuinely new file
is one migration; everything else is a targeted edit to an existing file, consistent
with the spec's framing of this as widening an existing pathway rather than building a
new one.

## Complexity Tracking

*No entries — no unjustified Constitution violations, and no new dependency to
justify.*
