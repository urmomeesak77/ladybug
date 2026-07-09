# Implementation Plan: Admin Meme Moderation Table

**Branch**: `010-admin-meme-moderation` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-admin-meme-moderation/spec.md`

## Summary

Add a role-gated back-office moderation console: a dedicated, bookmarkable page that lists
**every** meme (activated or not, deleted or not) in a compact table — 100 rows per page,
newest-first, page-based numbered links — with per-row Activate/Deactivate and
Delete/Restore actions, and a clickable row that opens the meme's own page. Access to the
page *and its data* is restricted to **admin or superuser** (the existing `Role` order),
enforced server-side by a new `role` route middleware and mirrored in the UI (nav link and
route both hidden/blocked below admin). Image rows reuse the existing `100`-size variant as
their thumbnail; YouTube rows get a thumbnail that is **downloaded once, lazily, on first
render** and stored under a dedicated media subtree, recorded by a new
`youtube_thumbnail` column (placeholder on failure, no queue introduced).

Technical approach: one new Eloquent-backed page-paginator query (`withTrashed`, ordered by
`created_at`), a thin admin controller + service pair on the backend reusing the existing
`Trashpost`/`Role`/`MediaPath`/`TrashpostImageService` machinery, and a new
`ModerationPage` + `lib/moderation*` + `useModeration` slice on the frontend that follows
the established `Api`/`AuthApi` + `Csrf` + `states/*` patterns.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript 5 / React 18 (Vite) frontend.

**Primary Dependencies**: Laravel 12, Sanctum (SPA cookie-session auth), Eloquent + MySQL,
Laravel HTTP client (Guzzle — already present) for the one-time YouTube thumbnail fetch,
`ext-gd` (already present) not needed here; React 18, React Router 6. **No new runtime
dependency** (Principle I) — the thumbnail download uses the framework's bundled HTTP client
and the existing `public` storage disk.

**Storage**: MySQL via Eloquent (`trashposts`, `users`). One additive migration adds a
nullable `youtube_thumbnail` string to `trashposts`. YouTube thumbnail image files live on
the `public` disk under a new dedicated subtree (`LADYBUG_DATA_ROOT\…\ladybug-storage`).

**Testing**: Backend PHPUnit on **sqlite :memory:** (run via the `php:8.3-cli` Docker
container; tests never touch the real DB and never hit the network — `Http::fake()` for the
thumbnail fetcher); frontend Vitest (+ Playwright e2e). ≥90% line coverage on both stacks.

**Target Platform**: Decoupled web app — Laravel JSON API + React SPA over Sanctum SPA
cookie-session.

**Project Type**: Web application (separate `backend/` and `frontend/`).

**Performance Goals**: Moderation index returns the first page within a few seconds
(SC-001). The lazy YouTube thumbnail download is a one-time cost per meme; once
`youtube_thumbnail` is set it is never re-fetched (SC-004).

**Constraints**: Page-based pagination (100/page) reflected in the URL and refresh-safe
(FR-004/FR-005); table must not overflow horizontally on mobile (Principle VIII); no DB ids
in URLs — the 10-char `hash` is the handle (Principle V); role gate enforced on the data,
not just the view (FR-002, Principle VI); Delete requires a lightweight confirmation, the
other three actions apply on a single click (FR-016).

**Scale/Scope**: Back-office table over the full `trashposts` corpus (thousands of rows,
paged 100 at a time); ~1 backend migration + middleware + controller + 2 services +
1 resource, and ~1 frontend page + 2 lib modules + 1 hook + a handful of components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment |
|-----------|-----------|
| **I. Minimal Dependencies** | ✅ No new npm/Composer package. YouTube thumbnail fetch uses Laravel's bundled HTTP client; storage uses the existing `public` disk and `MediaPath` shard rules. |
| **II. Coding Conventions** | ✅ PHP: `declare(strict_types=1)`, PSR-12, typed, functions <30 lines, one-class-of-static-methods for services/utils. TS: 2-space, semicolons, `is/has` booleans, functions <50 lines, `lib/*` as static-method classes; React components/hooks stay functions. |
| **III. Browser-Native Navigation** | ✅ Page-based numbered links write `?page=N`; Back/Forward/Refresh restore the exact page. Row click opens `/posts/{hash}`. (The 10-at-a-time/200-break infinite scroll in Principle III governs the *public feed*; this back-office table is page-based per the spec's explicit decision — still a real shareable URL per view.) |
| **IV. Theme & Accessibility** | ✅ Reuses the site's `prefers-color-scheme` theming. Activated/Deleted columns convey state with **text (+icon)**, never color alone. Table has `<caption>`/scope headers; action buttons have discernible names; thumbnails have `alt`. |
| **V. Stable Meme Identifiers** | ✅ URLs and every action endpoint key on the 10-char `hash`; the DB `id` is never exposed (row resource omits it). |
| **VI. Security & Input Validation** | ✅ `role:admin` middleware gates the page data server-side (guests → 401 via `auth:sanctum`, members → 403); YouTube id is re-validated (`Youtube::extractId`) before composing the remote thumbnail URL (no blind fetch of user input); ORM-only queries; output escaped by React/JSON; no secrets added. |
| **VII. Test Coverage & Organization** | ✅ Mirrored tests under each `tests/` tree (`tests/Feature/Http/Controllers/Admin/…`, `tests/Unit/Services/ModerationServiceTest.php`, `tests/unit/lib/moderation*`, component tests). Covers happy path + edges (empty, out-of-range page, missing variant, failed/again YouTube fetch, row-vs-action click, concurrent/repeated toggles). |
| **VIII. Responsive Layout** | ✅ Mobile-first; the wide table lives in an `overflow-x:auto` container so the **page** never scrolls horizontally; controls keep adequate touch targets. |

**Result**: PASS — no violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-admin-meme-moderation/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── admin-moderation-api.md
├── spec.md              # Feature spec (already present)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/                                   # Laravel 12 API
├── app/
│   ├── Http/
│   │   ├── Controllers/Admin/
│   │   │   └── ModerationController.php    # NEW: index + activate/deactivate/delete/restore
│   │   ├── Middleware/
│   │   │   └── EnsureRole.php              # NEW: `role:admin` gate (admin-or-higher)
│   │   └── Resources/
│   │       └── AdminTrashpostResource.php  # NEW: compact moderation row (hash, thumb, user, created, activated, deleted, url)
│   ├── Services/
│   │   ├── ModerationService.php           # NEW: paged withTrashed feed + the 4 state transitions
│   │   └── YoutubeThumbnailService.php     # NEW: lazy one-time fetch+store, returns URL or null
│   ├── Support/
│   │   └── MediaPath.php                    # EDIT: add youtubeThumbnailRelativePath()
│   └── Models/Trashpost.php                # EDIT: add youtube_thumbnail to $fillable
├── database/migrations/
│   └── 2026_07_09_000000_add_youtube_thumbnail_to_trashposts_table.php   # NEW
├── routes/api.php                          # EDIT: /api/admin/posts group (auth:sanctum + role:admin)
├── bootstrap/app.php                       # EDIT: alias 'role' => EnsureRole::class
└── tests/
    ├── Feature/Http/Controllers/Admin/ModerationControllerTest.php   # NEW
    ├── Feature/Http/Middleware/EnsureRoleTest.php                    # NEW
    ├── Unit/Services/ModerationServiceTest.php                       # NEW
    ├── Unit/Services/YoutubeThumbnailServiceTest.php                 # NEW
    ├── Unit/Http/Resources/AdminTrashpostResourceTest.php           # NEW
    └── Unit/Support/MediaPathTest.php                               # EDIT: youtube-thumb path cases

frontend/                                  # React 18 + Vite + TS SPA
├── src/
│   ├── pages/
│   │   └── ModerationPage.tsx             # NEW: /admin/memes — table + pagination + empty state
│   ├── components/
│   │   ├── RequireRole.tsx               # NEW: min-role route gate (admin+)
│   │   ├── LeftMenu.tsx                  # EDIT: admin-only Moderation link
│   │   └── moderation/
│   │       ├── ModerationTable.tsx       # NEW
│   │       ├── ModerationRow.tsx         # NEW (row click nav + action cell)
│   │       ├── ModerationThumbnail.tsx   # NEW (img with onError → placeholder)
│   │       ├── ModerationActions.tsx     # NEW (Activate/Deactivate, Delete w/ confirm, Restore)
│   │       └── ModerationPagination.tsx  # NEW (numbered ?page links)
│   ├── hooks/
│   │   └── useModeration.ts             # NEW: load page from ?page, apply action in place
│   ├── lib/
│   │   ├── moderationApi.ts             # NEW: ModerationApi (fetchPage + 4 actions, Csrf)
│   │   └── moderationModel.ts           # NEW: ModerationModel (row map, page-link math, state labels)
│   └── App.tsx                          # EDIT: /admin/memes route under RequireRole
└── tests/
    ├── unit/lib/moderationModel.test.ts          # NEW
    ├── unit/lib/moderationApi.test.ts            # NEW
    ├── unit/hooks/useModeration.test.tsx         # NEW
    ├── unit/components/moderation/*.test.tsx     # NEW
    └── e2e/moderation.spec.ts                    # NEW (role gate + browse + action, Playwright)
```

**Structure Decision**: Web-application layout (Option 2). The feature slots into the
established two-app structure: backend logic in `app/Http` + `app/Services` with mirrored
`tests/`, frontend in `pages/` + `components/` + `hooks/` + `lib/` with mirrored `tests/`.
Admin-only server code is namespaced under `Http/Controllers/Admin`; admin-only UI under
`components/moderation/`. No new top-level directories or apps.

## Complexity Tracking

No Constitution violations — this section is intentionally empty.
