# Implementation Plan: Video Upload

**Branch**: `019-video-upload` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-video-upload/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add video as a third upload media type (alongside image and YouTube): members pick
an MP4 or WebM file (≤20 MB) on the existing upload form, the backend deep-validates
it and generates a never-upscaled poster still via a new `ffmpeg` dependency, and the
resulting post reuses the identical trust-based auto-activation, moderation, and feed
machinery already built for image/YouTube posts. Feed and permalink playback is
inline, muted, and starts/stops on scroll visibility via a new IntersectionObserver
hook that mirrors the existing infinite-scroll observer pattern.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript (React 18 + Vite) frontend — unchanged.

**Primary Dependencies**: Existing stack (Laravel, Sanctum, React, React Router) plus
one **new** system dependency: `ffmpeg`/`ffprobe` (apt package, approved 2026-08-05 —
see [research.md](./research.md) item 2), invoked via Laravel's `Process` facade the
same way `gifsicle` already is for animated GIFs.

**Storage**: MySQL via Eloquent (one new nullable `trashposts.poster` column); files
on the `public` disk under the already-reserved `video/trash/` root (contract:
[contracts/media-layout-video.md](./contracts/media-layout-video.md)) plus the
existing `image/trash/` tree (reused for posters).

**Testing**: PHPUnit (backend, ≥90% coverage gate), Vitest + Playwright (frontend) —
unchanged toolchain; new fixture video files under `backend/tests/fixtures/`.

**Target Platform**: Web (existing responsive, themed SPA + JSON API) — unchanged.

**Project Type**: Web application (existing `backend/` + `frontend/` split) — unchanged.

**Performance Goals**: A video upload publishes in comparable time to a similarly
sized image upload (SC-001) — poster extraction is one `ffmpeg` invocation on a
≤20 MB file, not a transcode.

**Constraints**: 20 MB max file size (hard reject, no exceptions); MP4/WebM only;
poster never upscaled past source resolution; muted autoplay only (no audio without
explicit user action, satisfying browser autoplay policies and FR-008).

**Scale/Scope**: Same feed/page-size/moderation scale as existing media types — this
feature adds a third branch to already-built pipelines, not a new subsystem.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies | **PASS (with approved addition)** | `ffmpeg` is a new system dependency; explicit owner approval obtained 2026-08-05 with written rationale (research.md #2) before this plan finalized — process followed, not bypassed. No new npm/Composer package. |
| II. Coding Conventions | PASS | New PHP/TS code will follow PSR-12 (4-space, Stroustrup braces, <30-line methods) and the TS class-based-helper convention; enforced at the existing lint gates. |
| III. Browser-Native Navigation | PASS | Video posts use the same `/posts/{hash}` permalink and feed pagination as every other post type — no new routes or navigation model. |
| IV. Theme & Accessibility | PASS | `<video>` element ships with an accessible unmute/pause control (FR-008); poster acts as the `alt`-text-bearing placeholder before playback, following the same pattern as image `alt` handling. |
| V. Stable Meme Identifiers | PASS | Video posts use the same `hash` column and URL scheme; no new identifier concept. |
| VI. Security & Input Validation | PASS | Server-side deep validation (MIME + `ffprobe` decodability + size) before any post is created, mirroring the existing image validation rigor (research.md #5); files stored with server-derived extensions, never client-supplied names. |
| VII. Test Coverage & Organization | PASS | New tests mirror existing paths (`tests/Feature/Http/Controllers/CreatePostTest.php`, `tests/Unit/Services/...`, frontend `tests/components|lib|hooks`) — no new top-level test directories. |
| VIII. Responsive, Multi-Device Layout | PASS | Video element reuses `MemeMedia`'s existing responsive container/aspect-ratio handling — no fixed-pixel sizing introduced. |

No unjustified violations — Complexity Tracking is empty (see below).

## Project Structure

### Documentation (this feature)

```text
specs/019-video-upload/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── api-posts.md
│   └── media-layout-video.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing two-app layout (`backend/` Laravel API + `frontend/` React/Vite SPA);
this feature only adds/extends files within it — no new top-level directories.

```text
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── TrashpostsApiController.php     # store(): add video branch (extends existing)
│   │   ├── Requests/
│   │   │   └── CreatePostRequest.php           # add `video` field + three-way exclusivity
│   │   ├── Resources/
│   │   │   ├── TrashpostResource.php           # add `video` field
│   │   │   └── AdminTrashpostResource.php      # thumbnail resolves from `poster` for type=video
│   │   └── Rules/
│   │       └── ValidVideo.php                  # NEW — ffprobe-backed decodability check
│   ├── Services/
│   │   ├── TrashpostService.php                # add attachVideo(), mirrors attachImage()
│   │   ├── TrashpostVideoProcessor.php         # NEW — write path: store file, extract poster, probe metadata
│   │   ├── TrashpostImageProcessor.php         # reused unchanged for poster variant generation
│   │   └── MediaOwnershipService.php           # ownedPaths(): add video file + poster variants
│   └── Support/
│       ├── MediaPath.php                       # add VIDEO_EXTENSIONS / isVideoFile()
│       └── FfmpegVideo.php                     # NEW — Process-facade wrapper (mirrors GifFile)
├── database/migrations/
│   └── …_add_poster_to_trashposts_table.php    # NEW
├── docker/php/Dockerfile                       # add ffmpeg apt package (dev)
└── tests/
    ├── Feature/Http/Controllers/CreatePostTest.php   # video branches added
    ├── Unit/Services/TrashpostVideoProcessorTest.php # NEW
    ├── Unit/Services/MediaOwnershipServiceTest.php    # video coverage added (create if absent)
    ├── Unit/Support/MediaPathTest.php                 # video-path coverage added
    └── fixtures/                                      # sample.mp4, sample.webm, corrupt fixture

frontend/
├── src/
│   ├── components/
│   │   ├── MediaTabs.tsx           # add 'video' tab
│   │   ├── UploadMediaField.tsx    # add video file-input branch
│   │   └── MemeMedia.tsx           # add <video> render branch + autoplay-on-scroll
│   ├── hooks/
│   │   └── useUploadForm.ts        # UploadMode gains 'video'
│   ├── lib/
│   │   ├── uploadApi.ts            # add uploadVideo()
│   │   ├── uploadModel.ts          # add video validation branch
│   │   └── feedModel.ts            # RawPost/FeedMedia gain 'video' kind
│   └── pages/
│       └── UploadPage.tsx          # no structural change (already mode-driven)
└── tests/
    ├── components/MediaTabs.test.tsx, UploadMediaField.test.tsx, MemeMedia.test.tsx
    ├── lib/uploadApi.test.ts, uploadModel.test.ts, feedModel.test.ts
    ├── hooks/useUploadForm.test.tsx
    └── e2e/upload.spec.ts          # video case added

deploy/php/Dockerfile               # add ffmpeg apt package (prod)
.github/workflows/ci.yml            # add ffmpeg apt install for backend job
docker-compose.e2e.yml              # inherits docker/php/Dockerfile — no separate change
```

**Structure Decision**: No new projects or directories — this feature extends the
existing `backend/`+`frontend/` split exactly where feature 008 (image/YouTube
upload) already lives, following the same file-per-concern layout. The only
genuinely new files are: one migration, one validation rule, one processor service,
one `Support` wrapper class (backend), and zero new frontend files (all changes
extend existing components/hooks/lib modules) — consistent with reusing feature 008's
architecture rather than introducing a parallel one for video.

## Complexity Tracking

*No entries — no unjustified Constitution violations. The one new dependency
(`ffmpeg`) went through Principle I's required approval-before-install process rather
than around it, and is documented with its rationale in research.md rather than here.*
