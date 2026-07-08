# Implementation Plan: User Roles (Backbone)

**Branch**: `009-user-roles` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-user-roles/spec.md`

## Summary

Give every account exactly one role from a fixed, strictly-ordered set —
**guest < member < admin < superuser** — and make that role observable and
comparable, without yet enforcing any privilege it will eventually gate. What
ships is the *data* (a `role` column on `users`), the *vocabulary* (one
authoritative role definition per stack), and the *plumbing* (role on the
account payload, an "outranks" primitive, and an operator-only way to seed the
first superuser).

Technical approach: a native **PHP backed enum `App\Enums\Role`** is the single
source of truth on the backend — it carries all four cases, their rank, an
`outranks()` comparison, and the assignable-subset guard. A migration adds
`users.role` as a non-null string defaulting to `member`, which both defaults
new rows and backfills every pre-existing account in one step (FR-004/FR-010).
The column is cast to `Role` on the model and **kept out of `$fillable`** so no
registration or account-update payload can escalate privilege (Principle VI);
the model's default attribute pins new accounts to `member`. `UserResource`
gains a `role` field, so the existing `/api/user`, register, and login payloads
expose it with no new endpoint — "guest" is simply the absence of a user
(`data: null`), mapped on the client. The first superuser is seeded by an
operator-run artisan command `user:make-superuser {email}`, which is not an
HTTP route and therefore unreachable as an ordinary in-app request (FR-009).

Frontend mirrors the backbone: an in-house `Role` helper class (`lib/role.ts`)
holds the same ordering and `outranks` logic, `AuthUser` gains `role`, and the
auth context exposes the current **effective role** (`user?.role ?? 'guest'`)
so future UI can branch on it. No menu, guard, or page behaviour changes yet —
that is the deferred, privilege-gating work (OOS-001). **Zero new dependencies.**

## Technical Context

**Language/Version**: PHP 8.2+ (`declare(strict_types=1)`, PSR-12) on Laravel 12;
TypeScript ~5 (strict) on React 18.3 built with Vite.

**Primary Dependencies**: None added. Backend uses a native PHP `enum` (language
feature), Eloquent enum casting, the migration system, and the artisan console —
all framework/language built-ins. Frontend adds one in-house class; no package.

**Storage**: MySQL via Eloquent. **One additive migration** — `users.role`,
`string`, `NOT NULL`, `DEFAULT 'member'`. Adding the column with a default
backfills every existing row to `member` (FR-010) without a separate data step.
No native MySQL `ENUM` type: a plain string keeps the migration identical across
MySQL and the SQLite `:memory:` test driver; the closed set is enforced in the
application layer (enum cast + validation), never by string-concatenated SQL.

**Testing**: Backend PHPUnit on SQLite `:memory:` — a `RoleTest` unit covering
all 16 ordered role pairs (SC-004), rank, and the assignable guard; `UserTest`
for the `member` default and the mass-assignment guard; `AuthControllerTest`
additions (register returns `role: member`, the user payload includes role);
`MakeSuperuserCommandTest` for the bootstrap. Frontend Vitest (coverage over
**all of `src/`**) — `lib/role.test.ts` mirroring the 16-pair matrix,
`lib/authApi.test.ts` for role mapping, and an `AuthProvider`/`useAuth` test for
the effective-role (guest vs stored) derivation. Both stacks stay ≥90%.

**Target Platform**: Decoupled web app — Vite SPA over JSON to the Laravel API;
dev origins `localhost:5173` (SPA) / `localhost:8000` (API). No new user-facing
route, so no Playwright e2e is added (see Structure Decision).

**Project Type**: Web application — `backend/` Laravel API + `frontend/` React
SPA. This feature touches **both** apps, data-and-plumbing only.

**Performance Goals**: None specific. Role lookups are in-memory enum
comparisons and a single already-loaded column; no query or payload of note is
added.

**Constraints**: Zero new dependencies (Principle I); one authoritative role
definition per stack, no duplicated/divergent lists (FR-012, SC-006); role is
**not mass-assignable** and the closed set is enforced server-side (Principle
VI, FR-005); the first-superuser mechanism is operator-only and never an in-app
request (FR-009); role is independent of email-verification and of owned content
(FR-011); ≥90% coverage on both stacks with mirrored tests (Principle VII). No
UI, navigation, theming, or responsive surface changes (backbone only), so
Principles III/IV/VIII have no new obligations here.

**Scale/Scope**: Backend — 1 enum, 1 migration, 3 small edits (User model,
UserResource, UserFactory), 1 console command; Frontend — 1 lib class, 2 edits
(authApi types/mapping, AuthProvider/context effective-role); mirrored tests on
both stacks. No new endpoint, page, or dependency.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Minimal Dependencies | New deps need approval + rationale | **PASS** — zero new npm/Composer packages and zero new containers. Backend uses a native PHP `enum` plus Eloquent casting, migrations, and the artisan console (all built-ins); frontend adds one in-house `Role` class. A dedicated roles/permissions package (e.g. spatie/laravel-permission) was considered and rejected: this feature is a single scalar column with a four-value ordering — writing it in-house is smaller than the package's surface (research D1). |
| II. Coding Conventions | PSR-12/4-space/strict_types, PHP fns <30 lines; 2-space/semicolons/camelCase, TS fns <50 lines; braces on single-line bodies; comments explain *why* | **PASS (planned)** — the enum's methods are small `match` expressions (no closures — a standing preference); the command is a thin handler like `SeedMediaCommand`; the TS `Role` class is `static` methods per the class-over-function rule. Pint + ESLint enforce. |
| III. Browser-Native Navigation | Real URLs, Back/Forward/Refresh restore, deep-linkable | **N/A** — no new routes or views. Role is exposed on existing payloads; no navigation surface changes (privilege-gated UI is OOS-001). |
| IV. Theme & Accessibility | `prefers-color-scheme`; color not sole signal; alt/labels/aria | **N/A** — no UI is added or changed in this backbone slice. |
| V. Stable Meme Identifiers | 10-char code in meme URLs | **N/A** — no meme URLs. Role adds no identifier and is not used in any URL; the operator command keys off the account's **email**, not a database id (respects "no DB ids in user-facing handles"). |
| VI. Security & Input Validation | Server-side validation; parameterized; escape output; secrets in env | **PASS** — `role` is deliberately excluded from `$fillable`, so register/login/account payloads cannot set or escalate it (privilege-escalation guard); the Eloquent enum cast + the enum's assignable-subset guard reject any out-of-set value (FR-005), and an invalid stored value surfaces as a data error rather than a silent downgrade (spec edge case); the first-superuser path is an operator CLI, never an HTTP route (FR-009); all access is through Eloquent (parameterized). No secrets involved. |
| VII. Test Coverage & Organization | ≥90%; tests mirror source under `tests/` | **PASS (planned)** — backend `tests/Unit/Enums/RoleTest.php`, `tests/Unit/Models/UserTest.php`, `tests/Feature/Console/MakeSuperuserCommandTest.php`, and `AuthControllerTest` additions; frontend `tests/lib/role.test.ts`, `tests/lib/authApi.test.ts`, `tests/components/AuthProvider.test.tsx`. The 16-pair "outranks" matrix (SC-004) is exhaustively asserted on both stacks. |
| VIII. Responsive Layout | Mobile→desktop, no horizontal scroll, fluid units, touch targets | **N/A** — no layout or component is added or changed. |

**Initial gate: PASS** — no violations, Complexity Tracking stays empty.

**Post-Phase-1 re-check: PASS** — the designed enum, single additive migration,
resource field, and operator command introduce no dependencies and uphold every
gate above (notably VI: role stays non-mass-assignable and server-enforced).

## Project Structure

### Documentation (this feature)

```text
specs/009-user-roles/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output (decisions D1–D6)
├── data-model.md        # Phase 1 output (Role set/order, users.role column)
├── quickstart.md        # Phase 1 output (run + validation guide)
├── contracts/           # Phase 1 output
│   ├── role.md              # backend: Role enum API, user payload field, console command
│   └── frontend.md          # Role helper API, AuthUser.role, context effective-role
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Enums/Role.php                        # NEW: backed enum {Guest,Member,Admin,Superuser};
│   │                                         #   rank(), outranks(), assignable(), tryFromValue()
│   │                                         #   — the ONE authoritative role definition (FR-012)
│   ├── Console/Commands/MakeSuperuserCommand.php # NEW: `user:make-superuser {email}` — operator
│   │                                         #   bootstrap of the first superuser (FR-009); not a route
│   ├── Http/Resources/UserResource.php       # EDIT: expose `role` (the enum value) (FR-007)
│   └── Models/User.php                        # EDIT: cast `role` => Role::class; default attribute
│                                             #   'member'; role stays OUT of $fillable (Principle VI)
├── database/
│   ├── migrations/2026_07_08_000001_add_role_to_users_table.php  # NEW: string role NOT NULL
│   │                                         #   DEFAULT 'member' (defaults new + backfills old — FR-010)
│   └── factories/UserFactory.php             # EDIT: default role member + admin()/superuser() states
└── tests/
    ├── Unit/
    │   ├── Enums/RoleTest.php                 # NEW: all 16 ordered pairs (SC-004), rank, assignable, tryFrom
    │   └── Models/UserTest.php                # NEW: default member; role not mass-assignable
    ├── Feature/
    │   ├── Console/MakeSuperuserCommandTest.php # NEW: promote / unknown email / already superuser
    │   └── Http/Controllers/AuthControllerTest.php # EDIT: register→role member; user payload has role

frontend/
├── src/
│   ├── lib/
│   │   ├── role.ts                            # NEW: Role class — RoleName union, ORDER, rank(),
│   │   │                                       #   outranks(), isAssignable() (mirrors backend enum)
│   │   └── authApi.ts                         # EDIT: AuthUser.role + RawUser.role + mapUser mapping
│   ├── hooks/useAuth.ts                        # EDIT: AuthContextValue gains `role: RoleName`
│   └── components/AuthProvider.tsx             # EDIT: derive effective role (user?.role ?? 'guest')
└── tests/                                      # mirrors src/ (Principle VII)
    ├── lib/role.test.ts                        # NEW: 16-pair matrix, rank, assignable
    ├── lib/authApi.test.ts                     # EDIT: role mapping
    └── components/AuthProvider.test.tsx         # EDIT: effective role guest vs stored
```

**Structure Decision**: Backend concentrates the role model in one native
`App\Enums\Role` (FR-012 / SC-006) and keeps existing patterns — a thin
`UserResource` edit, a `SeedMediaCommand`-style console command, and a single
additive migration whose column default doubles as the FR-010 backfill. Frontend
follows the established `lib/`-class split: `Role` is a `static`-method class
mirroring the enum, consumed through the auth context's derived effective role,
with every touched module carrying a mirrored Vitest test. **No new e2e** is
added: this slice changes no user-visible route or behaviour (guest sees the
same site; a logged-in user sees the same UI — role is not yet gated), so the
existing Playwright suite already covers the unchanged flows, and the backbone's
correctness lives in the unit/feature tests above. When a later feature attaches
a privilege to a role, its own plan adds the e2e for that behaviour.

## Complexity Tracking

> No constitutional violations — table intentionally empty.
