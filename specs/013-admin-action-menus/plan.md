# Implementation Plan: Admin Action Menus

**Branch**: `013-admin-action-menus` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-admin-action-menus/spec.md`

## Summary

Reshape the per-row controls on both admin consoles — `/admin/users` and
`/admin/trashposts` — from inline buttons into a single shared "more actions"
kebab menu, and add one genuinely new capability: **permanent hard-deletion of a
user account**. The menu is built in-house (no new dependency): an accessible
WAI-ARIA *menu button* that opens, is keyboard-operable, and dismisses on Escape,
outside click, or focus loss (US3, FR-001–FR-006).

The new backend surface is a **single endpoint** — `DELETE /api/admin/users/{hash}`
— that hard-deletes the account when the acting admin *strictly outranks* it,
returning `204`. Everything the spec asks of deletion beyond that is already
guaranteed by existing database constraints: `trashposts.user_id` is
`nullOnDelete` (memes are orphaned, never cascade-deleted — FR-010), and
`users.disabled_by` is `nullOnDelete` (accounts the deleted admin had disabled
simply lose the actor name — FR-011). `RatingService` already no-ops on a null
owner, so orphaned memes remain fully moderatable. No migration, no new column,
no audit trail (FR-020).

The moderation console change (US2) is **presentation-only**: the existing
activate/deactivate/soft-delete/restore/purge actions, their confirmations, and
their in-place row refresh / row removal are reused unchanged inside the new menu.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript 5 / React 18 (Vite) frontend

**Primary Dependencies**: Laravel 12, Sanctum (SPA cookie session), Eloquent; React 18, React Router — all already present. **No new dependencies** (Principle I).

**Storage**: MySQL via Eloquent. No schema change — the required orphan/null-actor behaviour is already enforced by existing `nullOnDelete` foreign keys.

**Testing**: Backend PHPUnit (sqlite `:memory:`, mirrored under `tests/`); frontend Vitest + Playwright e2e. ≥90 % line coverage gate on both stacks (Principle VII).

**Target Platform**: Web SPA over JSON API; admin consoles gated to admin-or-higher.

**Project Type**: Web application — decoupled `backend/` (Laravel) + `frontend/` (React) apps.

**Performance Goals**: Back-office table interaction; no throughput target. Menu open/close is local UI state with no network cost.

**Constraints**: Menu is transient state only — it MUST NOT touch the page URL or Back/Forward/Refresh (FR-019). Keyboard-operable and screen-reader-labelled (FR-003–FR-005, Principle IV). Responsive/touch-friendly targets (Principle VIII).

**Scale/Scope**: Two consoles, one new endpoint, one new shared component, refactors of two existing per-row action components. ~100 rows/page (unchanged paging).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Minimal Dependencies | ✅ PASS | The kebab menu is built in-house from a plain button + `role="menu"` container; no dropdown/menu library is added. No new Composer/npm packages. |
| II. Coding Conventions | ✅ PASS | Menu logic lives in classes/hooks per conventions; components stay < 50 lines JS / services < 30 lines PHP; `declare(strict_types=1)`; braces on single-line bodies. |
| III. Browser-Native Navigation | ✅ PASS | The menu is transient interface state (FR-019); it never changes the URL. Paging URLs and Back/Forward/Refresh are untouched. |
| IV. Theme & Accessibility | ✅ PASS (core of US3) | Menu button exposes `aria-haspopup="menu"` + `aria-expanded`; items are `role="menuitem"` with text labels; destructive emphasis is never the sole signal (FR-002/FR-005). Keyboard + dismiss behaviour is a first-class requirement. |
| V. Stable Meme Identifiers | ✅ PASS | Every action addresses accounts and memes by their 10-char public `hash`, never a DB id (FR-018). |
| VI. Security & Input Validation | ✅ PASS | Hard delete is server-guarded by strict-rank re-check *inside the transaction* on freshly loaded rows (FR-009); the SPA sends only the hash and the CSRF header. Permission is never trusted from the client. |
| VII. Test Coverage | ✅ PASS | New service method + endpoint get mirrored PHPUnit tests; the shared menu, refactored action components, API client, and model helpers get mirrored Vitest tests; a Playwright slice covers the delete-with-confirm flow. ≥90 %. |
| VIII. Responsive Layout | ✅ PASS | The menu control and its items use adequate touch target sizes and reflow within the existing responsive admin tables; no fixed-width assumptions. |

**Result**: PASS — no violations, no entries required in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-admin-action-menus/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── admin-user-delete-api.md
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/Controllers/Admin/
│   │   └── UserAdminController.php      # + destroy(): DELETE /api/admin/users/{hash} → 204
│   └── Services/
│       └── UserAdminService.php         # + destroy(User $actor, string $hash): void (hard delete, strict-rank guard)
├── routes/api.php                       # + Route::delete('/users/{hash}', [UserAdminController, 'destroy'])
└── tests/
    ├── Feature/Http/Controllers/Admin/UserAdminControllerTest.php   # + destroy cases (204/403/404, orphan, null-actor)
    └── Unit/Services/UserAdminServiceTest.php                       # + destroy unit cases

frontend/
├── src/
│   ├── components/admin/
│   │   └── ActionMenu.tsx               # NEW shared kebab menu (button + role="menu", keyboard, dismiss)
│   ├── components/users/
│   │   ├── UserActions.tsx              # refactor: render ActionMenu (Enable/Disable + Delete permanently + confirm)
│   │   ├── UserRow.tsx                  # thread onRemove alongside onApply
│   │   └── UserTable.tsx                # thread onRemove
│   ├── components/moderation/
│   │   └── ModerationActions.tsx        # refactor: render the same ActionMenu (presentation only)
│   ├── hooks/
│   │   └── useUserAdmin.ts              # + removeRow(hash) (mirrors useModeration.removeRow)
│   ├── lib/
│   │   ├── userAdminApi.ts              # + destroy(hash): DELETE → { ok }
│   │   └── userAdminModel.ts            # + dropRow(rows, hash)
│   └── pages/
│       └── UserAdminPage.tsx            # pass removeRow into the table
└── tests/                               # mirrored Vitest for each of the above + Playwright delete slice
```

**Structure Decision**: The decoupled `backend/` + `frontend/` layout is unchanged.
The shared menu lives at `frontend/src/components/admin/ActionMenu.tsx` — the same
`admin/` folder that already houses `AdminPagination`, since both consoles consume
it. Both `UserActions` and `ModerationActions` are refactored to render items
*through* the shared menu rather than each owning bespoke button markup.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
