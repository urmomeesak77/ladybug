# Implementation Plan: Media Storage Location (Seed from Prototype)

**Branch**: `003-media-storage` | **Date**: 2026-06-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-media-storage/spec.md`

## Summary

Establish the Ladybug backend's canonical on-disk media location and seed it with the
Trashpost prototype's existing image library. Media lives on Laravel's `public`
storage disk, mirroring the prototype layout: images at
`image/trash/{size}/{shard}/{code.ext}` (sizes `original,800,500,300,100`) and future
videos at `video/trash/{shard}/{code.ext}` (no size variants). The seed is delivered
as a **Laravel Artisan command** (`php artisan media:seed`) that copies every media
file from the prototype source into the `public` disk, preserving the size/shard
structure, skipping non-media files, running idempotently, and emitting a verification
report (per-size source-vs-dest counts, checksum mismatches, destination stray-file
count). Path/shard/extension rules are factored into a pure, reusable
`App\Support\MediaPath` helper that the future upload feature will share. No new
dependencies (no image library — files are copied as-is, never resized). Media is
already excluded from version control by Laravel's `storage/app/public/.gitignore`
(`*` + `!.gitignore`); the seed adds no committed media.

## Technical Context

**Language/Version**: PHP 8.3 (composer platform pin; `require` floor `^8.2`)

**Primary Dependencies**: Laravel 12 (Filesystem/Storage + Artisan console); no new dependencies

**Storage**: Laravel `public` disk → `backend/storage/app/public/` (`image/trash/…`, `video/trash/…`). Source = prototype tree at `C:\projects\trash\storage\app\public\image\trash` (configurable via `--source` / `MEDIA_SEED_SOURCE`)

**Testing**: PHPUnit 11 via `php artisan test`; `Storage::fake('public')` + temp source fixtures (no 1.3 GB copy in tests)

**Target Platform**: Developer workstation (Windows) for the one-time seed run; Linux container/CI for tests

**Project Type**: Web application — decoupled `backend/` (Laravel API) + `frontend/` (React); this feature touches `backend/` only

**Performance Goals**: One-time bulk copy of ~8.7k files / ~1.3 GB must complete reliably; idempotent re-run skips already-present identical files (no correctness dependence on speed)

**Constraints**: Copy bytes verbatim (no resize/re-encode); media-extension allowlist only (`jpg,jpeg,png,gif`); use Storage/File APIs (no path traversal, no raw SQL); source path never hardcoded as a secret; media never committed; coverage ≥ 90%

**Scale/Scope**: 1 new helper (`MediaPath`), 1 new Artisan command (`SeedMediaCommand`), 2 new test files, `.env.example` addition. No DB, no HTTP, no UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies (NON-NEGOTIABLE) | ✅ PASS | No new npm/Composer packages. Uses Laravel's Filesystem + Artisan already in the baseline. No image library needed (copy as-is, no resizing). |
| II. Coding Conventions | ✅ PASS | PHP files use `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, functions < 30 lines, braces on single-line bodies; comments explain *why*. |
| III. Browser-Native Navigation | ➖ N/A | No UI/navigation in this feature. |
| IV. Theme & Accessibility | ➖ N/A | No UI in this feature. |
| V. Stable Meme Identifiers | ✅ PASS | Filenames (the prototype's existing codes) are treated as opaque and preserved verbatim; this feature does not mint or re-validate codes. Consistent with feature 002's documented `hash` decision. |
| VI. Security & Input Validation | ✅ PASS | Copies only allowlisted media extensions (rejects stray/control files); writes via `Storage::disk('public')` (no traversal); no raw SQL; source path is a configurable option/env, not a committed secret; no media or secrets committed. |
| VII. Test Coverage & Organization | ✅ PASS | `MediaPath` and `SeedMediaCommand` live under `app/` (coverage source set) and are covered by tests under `tests/` mirroring source (`tests/Unit/Support/MediaPathTest.php`, `tests/Feature/Console/SeedMediaCommandTest.php`); overall coverage stays ≥ 90%. Tests use small fixtures, not the 1.3 GB payload. |
| Tech & Architecture Constraints | ✅ PASS | Backend-only; Laravel Filesystem on the `public` disk; no second image library. |

**Initial gate result**: PASS (no violations). Re-checked after Phase 1 design — still PASS (no new violations; see end of document). Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-media-storage/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (pre-existing)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── media-layout.md       # On-disk media path/shard convention contract
│   └── seed-media-command.md # `php artisan media:seed` CLI contract
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Support/
│   │   └── MediaPath.php              # NEW: pure helpers — imageSizes(), shardFor(),
│   │                                  #      imageRelativePath(), videoRelativePath(), isMediaFile()
│   └── Console/
│       └── Commands/
│           └── SeedMediaCommand.php   # NEW: `media:seed` — enumerate source, copy media,
│                                      #      idempotent skip, build verification report, exit code
├── tests/
│   ├── Unit/
│   │   └── Support/
│   │       └── MediaPathTest.php      # NEW: shard rules, sizes, image/video paths, extension allowlist
│   └── Feature/
│       └── Console/
│           └── SeedMediaCommandTest.php  # NEW: copy structure, skip non-media, idempotency, report + exit code
└── .env.example                       # AMEND: add MEDIA_SEED_SOURCE placeholder (prototype path)

backend/storage/app/public/           # Seed destination (image/trash/…, video/trash/…)
└── .gitignore                        # EXISTING (* + !.gitignore) — already excludes all media
```

**Structure Decision**: Web-application layout; only the Laravel `backend/` is touched.
Path logic is isolated in `App\Support\MediaPath` (pure, no I/O) so it is unit-testable
and reusable by the future upload feature; the I/O orchestration and reporting live in
the `SeedMediaCommand`. Tests mirror source per Constitution Principle VII, following the
existing `app/Support/PublicCode.php` → `tests/Unit/Support/PublicCodeTest.php` pattern.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
