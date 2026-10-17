# Implementation Plan: Queued Background Work

**Branch**: `024-queued-background-work` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/024-queued-background-work/spec.md`

## Summary

Take slow work off the three php-fpm request workers. Uploads are validated and staged in the
request, then a durable database-queue job runs the EXISTING media processors and flips the post
from *processing* to *ready* (activating/crediting a trusted uploader in the same transaction) or
*failed*. Verification and recovery mail are queued; the whole recovery decision moves into a job
so the forgot-password request does identical work for every address. A dedicated, memory-capped,
self-recycling `queue:work` service runs the jobs. The SPA shows the uploader an accessible
processing/failed state that updates itself.

## Technical Context

**Language/Version**: PHP 8.3 (Laravel 12), TypeScript 5 / React 18

**Primary Dependencies**: existing only — Laravel queue (database driver), Notifications; ext-gd,
gifsicle, ImageMagick, ffmpeg (already approved); `pcntl` bundled PHP extension enabled in the
images (not a Composer/npm dependency)

**Storage**: MySQL 8 (`trashposts` + 2 columns; existing `jobs`/`failed_jobs`); private `local`
disk for staged uploads; `public` disk for media (unchanged)

**Testing**: PHPUnit (sqlite :memory:, `QUEUE_CONNECTION=sync`, `Queue::fake` where the dispatch
itself is under test), Vitest; Playwright e2e stays on `sync`

**Target Platform**: Linux containers on a 1 vCPU / 960 MiB VPS

**Project Type**: web application (`backend/` API + `frontend/` SPA)

**Performance Goals**: SC-001..SC-005 — page loads unaffected by concurrent uploads; upload
request < 2 s after transfer; recovery request timing independent of the address

**Constraints**: total container memory within the deploy budget; no new packages; ≥90% coverage

**Scale/Scope**: one worker, jobs processed serially; ~6 new backend classes, 1 migration, 2
frontend components

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Minimal Dependencies | PASS | No Composer/npm additions. `pcntl` is a bundled PHP extension (like gd/zip already enabled). |
| II. Coding Conventions | PASS | Jobs/notifications as small classes; functions < 30 lines PHP / < 50 JS; no closures in new code where avoidable. |
| III. Navigation | PASS | Processing state lives at the post's real URL; refresh/back restore it; swap in place. |
| IV. Theme & a11y | PASS | `role="status"`/`role="alert"` text states; colour/spinner decorative; reduced motion respected. |
| V. Stable IDs | PASS | Hash minted at request time exactly as today; jobs reference the hash, never a DB id in URLs. |
| VI. Security | PASS | All validation stays in the request before anything is stored; staged files on the private disk; FR-004 removes a timing oracle; mail never sent to a deleted account. |
| VII. Tests | PASS | Every job, the state transitions, visibility scope, 409 activate, and both UI states get tests; mirrors `app/Jobs` → `tests/Unit/Jobs`. |
| VIII. Responsive | PASS | The status blocks reflow like the existing post card. |

Post-design re-check: PASS (no violations; Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/024-queued-background-work/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/api-posts.md, contracts/ui-processing-state.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
backend/
├── app/Jobs/                      # NEW: ProcessPostMedia, FetchYoutubeThumbnail, SendRecoveryLink
├── app/Notifications/             # NEW: QueuedVerifyEmail, QueuedResetPassword
├── app/Models/Trashpost.php       # media_state in scopePubliclyVisible; casts
├── app/Models/User.php            # send*Notification overrides
├── app/Services/TrashpostService.php      # createPost: stage + dispatch; findViewableByHash
├── app/Services/ModerationService.php     # activate refuses non-ready (409); purge drops source
├── app/Services/PasswordService.php       # request path dispatches SendRecoveryLink
├── app/Support/{FfmpegVideo,GifFile,WebpFile}.php  # per-call Process timeouts
├── app/Http/Resources/{Trashpost,AdminTrashpost}Resource.php  # media_state
├── database/migrations/2026_10_14_000000_add_media_state_to_trashposts_table.php
└── tests/Unit/Jobs/, tests/Unit/Notifications/, + updated Feature/Unit tests
frontend/
├── src/components/PostProcessing.tsx      # NEW: processing / failed blocks
├── src/hooks/usePost.ts                   # re-fetch while processing
├── src/pages/PostPage.tsx                 # render by media_state
├── src/lib/feedModel.ts / postModel       # media_state field
├── src/components/moderation/*           # badge + Activate gating
└── tests/ (mirrors)
deploy/docker-compose.prod.yml   # ladybug-queue service, memory budget
deploy/php/Dockerfile, docker/php/Dockerfile   # pcntl
deploy/backend.env.example       # QUEUE_CONNECTION=database, DB_QUEUE_RETRY_AFTER=210
docker-compose.yml               # dev queue service
docs/DEPLOYMENT.md               # worker, failed jobs runbook
```

**Structure Decision**: existing two-app layout; new code goes in conventional Laravel `app/Jobs`
and `app/Notifications` directories with mirrored tests.

## Complexity Tracking

None.
