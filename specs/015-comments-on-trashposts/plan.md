# Implementation Plan: Trashpost Comments

**Branch**: `015-comments-on-trashposts` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-comments-on-trashposts/spec.md`

## Summary

Add flat, plain-text comments to a trashpost's own page. Any visitor reads them
(newest-first, batched 10 at a time with a "load more older comments" control); only a
signed-in, e-mail-verified account may post one (same gate as upload, 008), and it appears
at the top in place without a reload; admins (and higher) may hide/unhide (reversible) or
permanently delete (confirmed) a comment inline on the post page.

Technical approach: a new `comments` table (own 10-char public `hash`, `trashpost_id` FK
cascade-on-purge, nullable `user_id` orphan-on-delete, `username` snapshot, `body`,
nullable `hidden_at`), a `CommentService` mirroring the state-guard/transaction style of
`ModerationService`, a public nested read/create controller (`CommentController` on
`/api/posts/{hash}/comments`) and an admin moderation controller
(`Admin\CommentModerationController` on the existing admin group), plus a React
`CommentSection` composed onto `PostPage` that reuses the shared `ActionMenu` (013),
`useNotice` confirm dialog, `Csrf`, and auth/role hooks. No new dependency.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript 5 / React 18 + Vite frontend.

**Primary Dependencies**: Existing stack only — Laravel, Sanctum (SPA cookie session),
Eloquent, React, React Router. **No new npm/Composer package** (Principle I).

**Storage**: MySQL via Eloquent; new `comments` table added by a Laravel migration. Tests
run on SQLite `:memory:` (foreign-key constraints enabled by Laravel default).

**Testing**: PHPUnit (backend, mirrored under `backend/tests/`, coverage via Docker
`php:8.3-cli` + pcov); Vitest + Playwright e2e (frontend, mirrored under `frontend/tests/`).

**Target Platform**: Decoupled web app — Laravel JSON API + React SPA over Sanctum cookie
session.

**Project Type**: Web application (separate `backend/` + `frontend/`).

**Performance Goals**: Comment posts appear at the top within a couple of seconds without a
full reload (SC-001). Comment listing is keyset-paged in batches of 10 (FR-019) so a
heavily-commented post never renders all comments at once.

**Constraints**: Comment body ≤ 1000 chars, non-empty after trim (FR-007, FR-008); output
rendered as literal plain text (React auto-escaping — never `dangerouslySetInnerHTML`,
FR-009); create gated at the data layer to verified accounts (FR-004); moderation gated to
admin+ at the route layer (FR-010); no DB ids in any URL (Principle V — comments carry
their own 10-char `hash`); themed/accessible/responsive comment section (FR-018,
Principles IV & VIII).

**Scale/Scope**: One new table; one new service; two new backend controllers (public nested
+ admin); ~4 new frontend components + 1 hook + 2 lib modules; `PostPage` integration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passing.*

| Principle | Assessment |
|-----------|-----------|
| **I. Minimal Dependencies** | PASS — no new npm/Composer dependency. Reuses Sanctum, Eloquent, React Router, and in-house helpers (`Str::createUniqueHash`, `ActionMenu`, `useNotice`, `Csrf`). A new named rate-limiter (`comments`) is app config, not a dependency. |
| **II. Coding Conventions** | PASS — PSR-12 + `declare(strict_types=1)`, PHP fns < 30 lines; TS 2-space/semicolons, `is`/`has` booleans, `lib/` modules as single-responsibility classes of statics; comments explain *why*. |
| **III. Browser-Native Navigation** | PASS — comments are a sub-section of the already-shareable `/posts/{hash}` page; batch position is deliberately not in the URL (clarified). No new route; Back/Forward/Refresh unaffected. |
| **IV. Theme & Accessibility** | PASS — comment section follows `prefers-color-scheme`; the form field has a `<label>`; hidden comments are marked by text/badge (not color alone); menu/controls carry `role`/`aria-*` (reused `ActionMenu`). |
| **V. Stable Identifiers** | PASS — each comment gets an immutable 10-char `[A-Za-z0-9-_]` `hash`; moderation routes key off the hash, never the DB id. |
| **VI. Security & Input Validation** | PASS — server-side validation (verified gate, length/empty) before persistence; Eloquent parameterized queries; body stored verbatim, escaped on output as plain text; CSRF header on all mutations; create throttled. |
| **VII. Test Coverage** | PASS — mirrored tests under each stack's `tests/`, ≥90% line coverage; happy path + edge cases (empty/over-length/markup, unknown post, guest/unverified/member refusal, hide→delete, purge cascade, orphaned author). |
| **VIII. Responsive Layout** | PASS — comment list, form, and controls reflow across mobile/tablet/desktop with no horizontal overflow, fluid units, adequate touch targets. |

**Result**: No violations. Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/015-comments-on-trashposts/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── comments-api.md          # public read + create (nested under a post)
│   └── admin-comments-api.md    # admin hide / unhide / delete
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Enums/                    # (existing) Role
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── CommentController.php            # NEW — GET/POST /api/posts/{hash}/comments
│   │   │   └── Admin/
│   │   │       └── CommentModerationController.php  # NEW — hide/unhide/delete by comment hash
│   │   ├── Requests/
│   │   │   └── CreateCommentRequest.php         # NEW — body required/trim/≤1000
│   │   └── Resources/
│   │       └── CommentResource.php              # NEW — public fields + viewer-aware `hidden`
│   ├── Models/
│   │   ├── Comment.php                          # NEW — belongsTo Trashpost + User; isHidden()
│   │   ├── Trashpost.php                        # EDIT — add comments() HasMany
│   │   └── User.php                             # EDIT — add comments() HasMany
│   └── Services/
│       └── CommentService.php                   # NEW — list/create/hide/unhide/delete + counts
├── database/
│   ├── migrations/
│   │   └── 2026_07_23_000000_create_comments_table.php   # NEW
│   └── factories/
│       └── CommentFactory.php                   # NEW
├── routes/api.php                               # EDIT — nested comment routes + admin comment routes
├── config/app.php                               # EDIT — comment_throttle default
├── app/Providers/AppServiceProvider.php         # EDIT — RateLimiter::for('comments', …)
└── tests/
    ├── Feature/Http/Controllers/CommentControllerTest.php               # NEW
    ├── Feature/Http/Controllers/Admin/CommentModerationControllerTest.php  # NEW
    └── Unit/Services/CommentServiceTest.php                             # NEW

frontend/
├── src/
│   ├── components/comments/
│   │   ├── CommentSection.tsx     # NEW — count + list + form/prompt + empty + load-more
│   │   ├── CommentList.tsx        # NEW
│   │   ├── CommentItem.tsx        # NEW — author, time, body, admin ActionMenu
│   │   └── CommentForm.tsx        # NEW — labeled textarea + submit + inline validation
│   ├── hooks/
│   │   └── useComments.ts         # NEW — load/append-older/prepend-new/moderate sequencing
│   ├── lib/
│   │   ├── commentModel.ts        # NEW — types, mapping, list reducer
│   │   └── commentApi.ts          # NEW — fetch page / create / hide / unhide / delete
│   └── pages/PostPage.tsx         # EDIT — render <CommentSection hash=… />
└── tests/                          # NEW — mirrors each of the above; + e2e comments spec
```

**Structure Decision**: Existing decoupled two-app layout (Constitution "Technology &
Architecture Constraints"). Backend adds one migration/model/service/request/resource and
two thin controllers wired into `routes/api.php`; frontend adds a `components/comments/`
folder, one hook, and two `lib/` class modules, integrated into the existing `PostPage`.
Everything mirrors already-built patterns (moderation service transactions, `ActionMenu`
kebab, `useNotice` confirm, keyset feed paging, viewer-aware resources).

## Complexity Tracking

No Constitution violations — section intentionally empty.
