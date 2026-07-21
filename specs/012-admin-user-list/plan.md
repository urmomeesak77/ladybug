# Implementation Plan: Admin User List

**Branch**: `012-admin-user-list` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-admin-user-list/spec.md`

## Summary

An admin-only account console at `/admin/users`: a newest-first, 100-per-page table of every
registered account showing name, e-mail, role, verification state, creation time and disabled
state, with a single-click Disable/Enable control per row. Disabling revokes **access only** —
sign-in is refused, live sessions stop working on their next request, and nothing about the
account's memes or rating changes.

Technically this is a thin feature on top of shipped infrastructure. Two nullable columns
(`users.disabled_at`, `users.disabled_by`) carry the state; the existing `users.hash` is
already the public row handle, so no new identifier is introduced. The API mounts inside the
existing `auth:sanctum` + `role:admin` group, so the access boundary comes for free. The
strict-rank guard reuses `Role::outranks()`, which — because a role never outranks itself —
delivers the peer, higher-rank *and* self-lockout protections in one comparison. Live-session
revocation is a single group-level middleware, and the SPA needs no new session logic because
`AuthApi.fetchCurrentUser` already reads any non-ok probe as anonymous. The frontend mirrors
the 010 moderation console's structure, sharing its page-link machinery rather than copying it.

No new dependency, on either stack.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript 5 / React 18 (Vite) frontend

**Primary Dependencies**: Existing baseline only — Laravel 12, Sanctum (SPA cookie session),
Eloquent; React 18, React Router. **Nothing new** (Principle I)

**Storage**: MySQL via Eloquent. One migration adding two nullable columns to `users`
(`disabled_at` timestamp, `disabled_by` self-referencing FK). Tests run on SQLite `:memory:`,
so the migration must be driver-portable

**Testing**: Backend PHPUnit (via the `php:8.3-cli` Docker container — no local PHP);
frontend Vitest + React Testing Library; Playwright for the e2e slice. ≥90% line coverage on
both stacks, enforced in CI

**Target Platform**: Web — Laravel JSON API + React SPA, same-origin session cookie

**Project Type**: Web application (decoupled `backend/` + `frontend/`)

**Performance Goals**: The list is a back-office table; one indexed page query with
`disabledBy` eager-loaded (no N+1 across 100 rows). The disable/enable middleware adds at
most one already-loaded-user field read per request

**Constraints**: Access strictly admin+ (FR-002); e-mail and role never added to any public
or member-facing payload (FR-018); no database ids in URLs or payloads (FR-020, Principle V);
disable must not touch content, activation, or rating (FR-010a); themed, accessible and
responsive with no horizontal page overflow (Principles IV/VIII)

**Scale/Scope**: 3 API endpoints + 2 auth enforcement points; 1 migration; ~4 backend classes;
1 SPA page with ~4 components, 1 hook, 2 lib modules; 1 small shared-pagination extraction

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see below.*

| Principle | Verdict | How this feature complies |
|---|---|---|
| **I. Minimal Dependencies** | ✅ PASS | No npm or Composer package added. Everything is built from Laravel/Sanctum/Eloquent and React/React Router. The one shared helper (`AdminPaging`) is ~20 in-house lines that *remove* duplication rather than import it. |
| **II. Coding Conventions** | ✅ PASS | PHP: PSR-12, `declare(strict_types=1)`, typed signatures, functions < 30 lines — the service splits `disable`/`enable` over a shared private `transition()` to stay well inside budget. TS: 2-space, semicolons, `PascalCase` components, `is`-prefixed booleans (`isDisabled`), functions < 50 lines. `lib/` modules stay single classes of `static` methods; no loose exported functions. |
| **III. Browser-Native Navigation** | ✅ PASS | `/admin/users` is a real shareable URL; paging writes `?page=N`, so Back/Forward/Refresh restore the exact page (FR-007). The 10-at-a-time / 200-break rule governs the public feed and does not apply to a back-office table — the spec fixes 100 per page, matching the shipped moderation console. |
| **IV. Theme & Accessibility** | ✅ PASS | Reuses the site layout's `prefers-color-scheme` theming. Verified and disabled states are conveyed in **text**, never colour alone (FR-005). The table is captioned with `scope="col"` headers; every action button carries an accessible name; page links mark the current page with `aria-current` (all mirroring the 010 table). |
| **V. Stable Identifiers** | ✅ PASS | Rows are addressed by the existing `users.hash` — 10 chars of `[A-Za-z0-9-_]`, unique, immutable, minted by `Str::createUniqueHash`. No auto-increment id appears in any URL or payload (FR-020, research D1). |
| **VI. Security & Input Validation** | ✅ PASS | Access gated server-side at the route group (guest 401 / member 403). The actor comes from the session, never the request body (FR-008b). The rank guard is re-evaluated server-side inside the transaction against current stored roles (FR-012). `disabled_at`/`disabled_by` stay out of `$fillable`, so no request body can reach them. Sign-in refusal verifies credentials **before** disclosing the disabled state, so the login form is not an account-state oracle (research D4). All access via Eloquent. No secrets involved. |
| **VII. Test Coverage & Organization** | ✅ PASS | Tests mirror source paths: `tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php`, `tests/Feature/Http/Middleware/EnsureAccountEnabledTest.php`, `tests/Unit/Services/UserAdminServiceTest.php`, `tests/Unit/Http/Resources/AdminUserResourceTest.php`; frontend `tests/pages/UserAdminPage.test.tsx`, `tests/components/users/*`, `tests/hooks/useUserAdmin.test.tsx`, `tests/lib/userAdminModel.test.ts`. Edge cases from the spec (self-lockout, peer/higher rank, out-of-range page, repeated toggles, unresolvable actor, concurrent action) each get a named test. ≥90% on both stacks. |
| **VIII. Responsive Layout** | ✅ PASS | The wide table lives in its own `overflow-x: auto` scroll container — the same pattern `.moderation-table__scroll` already uses — so the table scrolls independently and the **page** never scrolls horizontally at 320px. Action controls keep adequate touch target size. |

**Initial gate**: PASS — no violations, so **Complexity Tracking is empty**.

**Post-design re-check (after Phase 1)**: PASS — unchanged. The design added no dependency,
no new identifier scheme, and no new public data exposure. Two points were explicitly settled
during design and are worth carrying into review:

- The `disabled_by` **database id** is stored but never serialized; `AdminUserResource`
  exposes the actor's *name* or null (data-model INV-3). This keeps Principle V intact while
  still getting referential integrity and the `nullOnDelete` degradation the spec's
  "unresolvable actor" edge case wants.
- The shared-pagination extraction (research D8) is deliberately **additive**: the 010 names
  remain as thin delegating wrappers, so a shipped feature is not destabilized as collateral
  of this one.

## Project Structure

### Documentation (this feature)

```text
specs/012-admin-user-list/
├── plan.md              # This file
├── research.md          # Phase 0 — D1..D10 decisions
├── data-model.md        # Phase 1 — users table change, transitions, read projection
├── quickstart.md        # Phase 1 — runnable validation guide
├── contracts/
│   └── admin-users-api.md   # Phase 1 — the three endpoints + auth enforcement points
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/Admin/
│   │   │   └── UserAdminController.php      # NEW — index / disable / enable
│   │   ├── Middleware/
│   │   │   └── EnsureAccountEnabled.php     # NEW — live-session revocation (FR-014)
│   │   └── Resources/
│   │       └── AdminUserResource.php        # NEW — the admin-only row projection
│   ├── Models/
│   │   └── User.php                         # CHANGED — cast, disabledBy(), isDisabled()
│   ├── Services/
│   │   └── UserAdminService.php             # NEW — paginate + disable/enable + rank guard
│   └── Http/Controllers/AuthController.php  # CHANGED — disabled sign-in refusal (FR-013)
├── bootstrap/app.php                        # CHANGED — append EnsureAccountEnabled to api group
├── database/
│   ├── migrations/
│   │   └── 2026_07_20_000002_add_disabled_to_users_table.php   # NEW
│   └── factories/UserFactory.php            # CHANGED — disabled() state for tests
├── routes/api.php                           # CHANGED — 3 routes in the admin group
└── tests/
    ├── Feature/Http/Controllers/Admin/UserAdminControllerTest.php   # NEW
    ├── Feature/Http/Controllers/AuthControllerTest.php              # CHANGED
    ├── Feature/Http/Middleware/EnsureAccountEnabledTest.php         # NEW
    ├── Feature/Database/SchemaTest.php                              # CHANGED
    ├── Unit/Services/UserAdminServiceTest.php                       # NEW
    └── Unit/Http/Resources/AdminUserResourceTest.php                # NEW

frontend/
├── src/
│   ├── pages/UserAdminPage.tsx              # NEW — /admin/users
│   ├── components/
│   │   ├── admin/AdminPagination.tsx        # NEW — shared numbered page links (research D8)
│   │   ├── users/
│   │   │   ├── UserTable.tsx                # NEW
│   │   │   ├── UserRow.tsx                  # NEW
│   │   │   └── UserActions.tsx              # NEW — the single Disable/Enable control
│   │   ├── moderation/ModerationPagination.tsx  # CHANGED — wraps AdminPagination
│   │   └── LeftMenu.tsx                     # CHANGED — admin-only "Users" entry (FR-003)
│   ├── hooks/useUserAdmin.ts                # NEW — ?page-driven fetch + in-place row update
│   ├── lib/
│   │   ├── adminPaging.ts                   # NEW — shared PageMeta / pageLinks / parsePage
│   │   ├── userAdminApi.ts                  # NEW — fetch page, disable, enable
│   │   ├── userAdminModel.ts                # NEW — Raw→row mapping, labels, row replace
│   │   └── moderationModel.ts               # CHANGED — delegates paging math to AdminPaging
│   └── App.tsx                              # CHANGED — the RequireRole-gated route
└── tests/                                   # mirrors src/ (Principle VII), incl. e2e/users.spec.ts
```

**Structure Decision**: The established decoupled two-app layout. The backend follows the 010
console's shape exactly — controller under `Http/Controllers/Admin/`, one service holding the
query and the transitions, one admin-only resource — so the new console is structurally a
sibling of the moderation console rather than a new pattern. On the frontend, the new page
reuses the 010 page/hook/lib/component decomposition and shares its page-link machinery via
the new `admin/` and `lib/adminPaging.ts` pieces instead of duplicating it.

## Complexity Tracking

No Constitution Check violations — this section is intentionally empty.
