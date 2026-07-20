# Implementation Plan: User Rating & Auto-Activation

**Branch**: `011-user-rating-auto-activation` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-user-rating-auto-activation/spec.md`

## Summary

Give every account a **rating** — a signed smallint that rises when its memes are activated and
falls when they are deleted — and use it to let proven contributors publish without waiting.
An upload auto-activates when its uploader's rating is ≥ 15 or the uploader is an admin or
superuser; otherwise it is created pending and waits for a moderator.

The technical shape is small: **three additive columns** (`users.rating`, plus
`trashposts.rating_credited` / `rating_penalized`), **one new service** (`RatingService`) that
owns every adjustment and the auto-activation predicate, and **one new field** on the admin
moderation row. No new tables, no new endpoints, no new dependencies.

The two per-meme boolean flags are what make the rating correct rather than approximately
correct. Every adjustment is conditional on a flag actually changing, which is what delivers
"at most one deletion penalty per meme" (FR-008), "activate/deactivate cycles never drift"
(FR-006), and "concurrent actions never double-count" (FR-014) — from one mechanism rather
than three special cases.

**Two findings from Phase 0 materially shape the work:**

1. **The spec's "upload does not yet exist" dependency is stale** (research D0). Feature 008
   shipped `POST /api/posts`, `TrashpostService::createPost()`, and `UploadPage.tsx`. So
   FR-015 … FR-020 are implementable now, and this is one deliverable rather than a contract
   deferred to a future feature. `createPost()` currently activates *every* upload
   unconditionally — making that conditional is a behaviour change to shipped code.
2. **Pending uploads would leak their media** (research D4). `TrashpostImageProcessor` writes
   variants to the **public** disk, which is harmless only because everything is activated
   today. The moment FR-018 leaves uploads pending, the row is hidden from the API while the
   bytes stay URL-addressable — exactly the bypass `MediaVisibilityService` exists to close.
   `createPost()` must call `MediaVisibilityService::sync()` on the pending branch.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript 5 / React 18 (Vite) frontend

**Primary Dependencies**: None added. Laravel, Sanctum, Eloquent, React, React Router — the
existing baseline. This feature is a Principle I no-op.

**Storage**: MySQL via Eloquent. Three additive, reversible columns across two existing tables.

**Testing**: Backend PHPUnit (sqlite `:memory:` only — `Tests\TestCase` hard-aborts otherwise);
frontend Vitest; Playwright for e2e. ≥90% line coverage on both stacks, enforced in CI.

**Target Platform**: Dockerized Laravel API + Vite SPA; mobile/tablet/desktop browsers.

**Project Type**: Web application — decoupled `backend/` API + `frontend/` SPA.

**Performance Goals**: No new N+1 (`paginate()` already eager-loads `with('user')`). Each
moderation action gains one short transaction with two row locks — negligible at moderation
scale (a handful of admins clicking buttons).

**Constraints**: Rating adjustments must be atomic with the action that caused them (FR-013)
and idempotent under concurrency (FR-014); ratings saturate rather than wrap at the smallint
bounds (FR-011a); no code path anywhere may set a rating to a chosen value (FR-003).

**Scale/Scope**: ~3 migrations, 1 new backend service, edits to 2 existing services, 1
resource, 3 frontend modules. Rating range −32768 … 32767.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Minimal Dependencies** | ✅ PASS | Zero new npm/Composer packages. Rejected a `rating_events` ledger table as unjustified structure (research D1). |
| **II. Coding Conventions** | ✅ PASS | New `RatingService` follows the existing service pattern; PHP methods stay well under 30 lines; PSR-12 + `declare(strict_types=1)`; frontend logic goes into the existing `ModerationModel` class, not loose functions. |
| **III. Browser-Native Navigation** | ✅ PASS | No routing change. `/admin/posts?page=N` behaviour is untouched; the table gains a column only. |
| **IV. Theme & Accessibility** | ✅ PASS | The rating cell is text, never colour-coded alone. Unowned memes render a literal "no account" — not a blank cell (FR-021). Both themes verified in quickstart. |
| **V. Stable Meme Identifiers** | ✅ PASS | No id is exposed. The rating is an account attribute reached through the meme's `hash`; `AdminTrashpostResource` still omits `id` and `user_id`. |
| **VI. Security & Input Validation** | ✅ PASS — **and strengthened** | `rating` is kept out of `$fillable` so no request can mass-assign it (FR-003 enforced structurally). Research D4 catches a real media-visibility leak that this feature would otherwise introduce. Rating is absent from all public payloads (FR-022). |
| **VII. Test Coverage & Organization** | ✅ PASS | `RatingService` is explicit and injectable (rejected Eloquent observers precisely because hidden global state resists testing — research D1). Tests mirror source: `tests/Unit/Services/RatingServiceTest.php`, `tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php`, `frontend/tests/lib/moderationModel.test.ts`. |
| **VIII. Responsive Layout** | ⚠️ PASS with attention | Adding a column to an already-wide admin table is the one real responsive risk. The table must scroll inside its own container at ~320px; the page itself must never scroll horizontally. Called out in the quickstart manual gate. |

**Post-Phase-1 re-check**: ✅ All gates still pass. The design added no dependency, no table, no
endpoint, and no public field. The Principle VI position improved — Phase 0 found a latent
media leak the feature would have shipped. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/011-user-rating-auto-activation/
├── plan.md              # This file
├── research.md          # Phase 0 — D0…D6 decisions
├── data-model.md        # Phase 1 — columns, adjustment table, worked sequences
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   └── rating-api.md    # Phase 1 — behavioural deltas on existing endpoints
├── spec.md
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Models/
│   │   ├── User.php                        # MODIFIED: rating stays out of $fillable (FR-003)
│   │   └── Trashpost.php                   # MODIFIED: cast rating flags to boolean
│   ├── Services/
│   │   ├── RatingService.php               # NEW: all adjustments + shouldAutoActivate()
│   │   ├── ModerationService.php           # MODIFIED: 5 transitions gain rating side effects
│   │   ├── TrashpostService.php            # MODIFIED: conditional activation + media sync
│   │   └── MediaVisibilityService.php      # unchanged — now called on the create path
│   └── Http/Resources/
│       ├── AdminTrashpostResource.php      # MODIFIED: + 'rating' (null when unowned)
│       └── UserResource.php                # unchanged — deliberately no rating (FR-022)
├── database/migrations/
│   ├── 2026_07_20_000000_add_rating_to_users_table.php            # NEW
│   └── 2026_07_20_000001_add_rating_flags_to_trashposts_table.php # NEW
└── tests/
    ├── Unit/Services/RatingServiceTest.php                        # NEW
    ├── Unit/Services/ModerationServiceTest.php                    # MODIFIED
    ├── Unit/Services/TrashpostServiceTest.php                     # MODIFIED
    └── Feature/Http/Controllers/Admin/ModerationControllerTest.php # MODIFIED

frontend/
├── src/
│   ├── lib/moderationModel.ts              # MODIFIED: rating on Raw/ModerationRow + label
│   └── components/moderation/
│       ├── ModerationTable.tsx             # MODIFIED: rating header
│       └── ModerationRow.tsx               # MODIFIED: rating cell / "no account"
└── tests/
    ├── lib/moderationModel.test.ts         # MODIFIED
    └── components/moderation/ModerationRow.test.tsx # MODIFIED
```

**Structure Decision**: The existing decoupled `backend/` + `frontend/` layout, unchanged. All
rating logic concentrates in one new backend service (`RatingService`) that both
`ModerationService` and `TrashpostService` call — the rating rule and the threshold it is
compared against live in one file and cannot drift apart. Frontend changes are display-only and
land in the existing `ModerationModel` class per the "one class of static methods per lib
module" convention.

## Implementation Notes

Detail that Phase 2 task generation will need, kept out of the artifacts above.

### RatingService shape

```
RatingService
  const TRUST_THRESHOLD = 15          // FR-016
  const MIN = -32768, MAX = 32767     // smallint bounds, FR-011a

  shouldAutoActivate(User): bool      // FR-016 + FR-017, read before the post exists (FR-020)
  credit(Trashpost): void             // activate:   flag false→true  ⇒ +1
  releaseCredit(Trashpost): void      // deactivate: flag true→false  ⇒ −1
  penalize(Trashpost): void           // delete:     flag false→true  ⇒ −1
  refund(Trashpost): void             // restore:    flag true→false  ⇒ +1
  settlePurge(Trashpost): void        // purge:      releaseCredit + penalize, one transaction
```

Each method: open a transaction, `lockForUpdate()` the **post row first, then the user row**
(fixed order — two moderators acting on two memes of the same owner must not deadlock), check
whether the flag actually changes, and only then clamp-and-write the rating. `user_id === null`
short-circuits to a flag-only update (FR-012).

Saturation is a clamp, not an `increment()`: `max(MIN, min(MAX, current + delta))`. A bare
atomic `increment()` cannot saturate and cannot read-check the flag in the same statement
(research D2).

### Wiring the call sites

- `ModerationService`: inject `RatingService` via the existing constructor-default pattern
  (`ModerationService.php:25`). **The five methods are not transactional today** — each is a
  bare `save()` followed by `media->sync()`. FR-013 therefore requires *introducing* a
  `DB::transaction()` per transition that encloses both the state change and the adjustment;
  this is new work, not a matter of adding a call to an existing block. `media->sync()` moves
  files and must stay outside that transaction, after commit. Note `purge()` computes
  `ownedPaths()` **before** `forceDelete()` today — the rating settlement must also land
  before the row goes away.
- `TrashpostService::createPost()`: call `shouldAutoActivate($user)` **before** `reserve()`,
  thread the result through to replace the current unconditional `activated_at = now()` in both
  `reserve()` (`:96`) and `attachImage()` (`:121`). On the pending branch, call
  `MediaVisibilityService::sync($post)` after the files are written (research D4). On the
  activated branch, call `RatingService::credit($post)` (FR-019).

### Test emphasis

Beyond the happy paths, the cases most likely to be got wrong:

- Purge of a live activated meme → **−2** in one operation (US1 §9), and −1 lifetime.
- Soft-delete → hard-delete → **one** penalty total, not two (FR-008).
- activate → deactivate → activate → **+1**, not +2 (FR-006).
- Every action on a `user_id = null` meme → succeeds, adjusts nothing (FR-012).
- Saturation at both bounds → rating unchanged, action still returns success (FR-011a).
- Upload at rating exactly **14 vs 15** → the boundary FR-016/FR-020 turn on.
- Pending upload's media is **not** on the public disk (research D4).
- A legacy meme (activated, `rating_credited = false`) deactivated → −1 (FR-002, SC-005).

## Complexity Tracking

> No Constitution Check violations. This feature adds no dependency, no table, no endpoint, and
> no public field. Nothing to justify.
