# Implementation Plan: Read-Side Feed API (Posts Feed & Single Post)

**Branch**: `004-read-feed-api` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-read-feed-api/spec.md`

## Summary

Expose the Ladybug backend's read-side API over the data seeded by features 002–003.
Two JSON endpoints: `GET /api/posts` returns the newest visible posts (10 per page)
with cursor pagination via a `start` post `hash` and a capped optional `limit`, and
`GET /api/posts/{hash}` returns a single visible post or 404. A post is **visible**
only when it has an `activated_at` timestamp and is not soft-deleted; ordering is
`activated_at DESC, id DESC` (deterministic tie-break for stable cursoring). Each post
serializes its stored fields plus a shareable URL, its API URL, and the URLs of every
image size that actually exists on disk (omitting absent sizes).

The query rules live in an injectable `App\Services\TrashpostService` (Eloquent
builder, < 30-line methods). Image URLs are built by a new
`App\Services\TrashpostImageService` that **reuses the existing `App\Support\MediaPath`**
helper (size/shard/path rules from feature 003) plus `Storage::disk('public')` for
existence + URL — no duplicated path logic. An `App\Http\Resources\TrashpostResource`
assembles the JSON. A new `TrashpostFactory` supports tests. This is a faithful,
convention-aligned port of the prototype's `TrashpostsApiController` /
`TrashpostResource` / `TrashpostService`. **No new dependencies** — Laravel routing,
Eloquent, `JsonResource`, and `Storage` are all in the baseline.

## Technical Context

**Language/Version**: PHP 8.3 (composer platform pin; `require` floor `^8.2`)

**Primary Dependencies**: Laravel 12 (routing, Eloquent, `JsonResource`, Filesystem/Storage); no new dependencies

**Storage**: MySQL (runtime) / SQLite `:memory:` (tests) via Eloquent for the `trashposts` table; Laravel `public` disk for image existence/URL lookups (`image/trash/{size}/{shard}/{code}.{ext}` from feature 003)

**Testing**: PHPUnit 11 via `php artisan test`; `RefreshDatabase` + `TrashpostFactory` for data, `Storage::fake('public')` for image-size fixtures (no real 1.3 GB library in tests)

**Target Platform**: Linux container/CI for tests; Laravel dev server for manual smoke

**Project Type**: Web application — decoupled `backend/` (Laravel API) + `frontend/` (React); this feature touches `backend/` only

**Performance Goals**: Feed responses bounded by the page size (≤ default 10, hard max ~50); cursor pagination avoids large offsets; per-post image lookup is a small fixed number of `Storage::exists` checks

**Constraints**: Read-only (no writes, no auth); Eloquent/parameterized queries only (no raw SQL); `limit` validated + capped; non-visible posts (not activated / soft-deleted) never leak; image URLs reflect only files present on disk; coverage ≥ 90%

**Scale/Scope**: 1 controller, 2 services, 1 resource, 1 factory, 2 routes; 3 new test files. No migrations, no UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies (NON-NEGOTIABLE) | ✅ PASS | No new npm/Composer packages. Uses Laravel routing, Eloquent, `JsonResource`, and `Storage` from the baseline. Reuses the existing `App\Support\MediaPath` helper. |
| II. Coding Conventions | ✅ PASS | All PHP uses `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, functions < 30 lines, braces on single-line bodies; comments explain *why*. Controller stays thin; logic in injectable services. |
| III. Browser-Native Navigation & Deep Linking | ✅ PASS (enables) | Backend serves the building blocks: feed addressable by a URL `start` cursor + `limit` query, and each post reachable directly by its public `hash` at `/api/posts/{hash}`. Frontend navigation/scroll is a later feature; this feature does not constrain it. |
| IV. Theme & Accessibility | ➖ N/A | No UI in this feature. |
| V. Stable Meme Identifiers | ✅ PASS | Posts are addressed by the opaque public `hash`, never the DB auto-increment id; the cursor is also a `hash`. Consistent with feature 002's documented `hash` decision (10-char). This feature reads codes; it does not mint/validate them. |
| VI. Security & Input Validation | ✅ PASS | Read-only; all queries via Eloquent (parameterized) — `hash`/`start` bound as parameters, never concatenated. `limit` is validated and capped; invalid values fall back to default. Output via `JsonResource` (Laravel-escaped). Non-activated and soft-deleted rows are excluded from both endpoints. No secrets touched. |
| VII. Test Coverage & Organization | ✅ PASS | New code under `app/` is covered by tests mirroring source: `tests/Unit/Services/TrashpostServiceTest.php`, `tests/Unit/Services/TrashpostImageServiceTest.php`, `tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`. Happy path + edge cases (pagination boundary, hidden/deleted 404, missing-size omission, link-only post). Coverage stays ≥ 90%. |
| VIII. Responsive, Multi-Device Layout | ➖ N/A | No UI in this feature. |
| Tech & Architecture Constraints | ✅ PASS | Backend-only Laravel JSON API; Eloquent only; page size 10 honored; public `hash` is the handle. Cursor pagination (prototype-faithful) is reflected in the URL via `start`/`limit`; the 200-entry "Load more" page break is a frontend concern this API supports but does not implement. |

**Initial gate result**: PASS (no violations). Complexity Tracking is empty. Re-checked
after Phase 1 design — still PASS (no new violations).

## Project Structure

### Documentation (this feature)

```text
specs/004-read-feed-api/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (pre-existing)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── feed-api.md           # GET /api/posts + GET /api/posts/{hash} JSON contract
├── checklists/
│   └── requirements.md       # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── TrashpostsApiController.php   # NEW: thin index() + show(); delegates to service + resource
│   │   └── Resources/
│   │       └── TrashpostResource.php         # NEW: model fields + url, url_api, image data
│   ├── Services/
│   │   ├── TrashpostService.php              # NEW: feed builder — visibility, order, limit cap, cursor
│   │   └── TrashpostImageService.php         # NEW: image URLs via MediaPath + Storage (existing-only sizes)
│   └── Support/
│       └── MediaPath.php                     # REUSE (feature 003) — size/shard/path rules
├── routes/
│   └── api.php                               # AMEND: add GET /posts and GET /posts/{hash}
├── database/
│   └── factories/
│       └── TrashpostFactory.php              # NEW: visible/hidden/deleted/link-only post states for tests
└── tests/
    ├── Unit/
    │   └── Services/
    │       ├── TrashpostServiceTest.php          # NEW: visibility, ordering, limit cap, cursor behavior
    │       └── TrashpostImageServiceTest.php     # NEW: existing-only sizes, default/original, no-file case
    └── Feature/
        └── Http/
            └── Controllers/
                └── TrashpostsApiControllerTest.php  # NEW: feed page, cursor, 404, JSON shape, image URLs
```

**Structure Decision**: Web-application layout; only the Laravel `backend/` is touched.
Query rules and image-URL building are isolated in injectable services
(`TrashpostService`, `TrashpostImageService`) so the controller stays thin and each
piece is unit-testable; the image service reuses `App\Support\MediaPath` rather than
re-deriving path/shard/size rules. Tests mirror source per Constitution Principle VII,
following the existing `app/Support/MediaPath.php` → `tests/Unit/Support/MediaPathTest.php`
pattern.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
