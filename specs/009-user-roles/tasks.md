---
description: "Task list for feature implementation: User Roles (Backbone)"
---

# Tasks: User Roles (Backbone)

**Input**: Design documents from `/specs/009-user-roles/`

**Prerequisites**: plan.md (required), spec.md (user stories), research.md, data-model.md, contracts/role.md, contracts/frontend.md, quickstart.md

**Tests**: INCLUDED — the plan mandates mirrored tests on both stacks with the exhaustive 16-pair "outranks" matrix (SC-004) and ≥90% coverage (Principle VII). Write tests before the code they cover.

**Organization**: Tasks are grouped by user story. The two authoritative role definitions (backend `App\Enums\Role` + frontend `lib/role.ts`) are the shared vocabulary (FR-012) and live in the Foundational phase because every story hangs off them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 (Setup / Foundational / Polish carry no story label)
- All paths are repo-relative. Backend runs through the Dockerised PHP (no local PHP).

## Path Conventions

- **Web app**: `backend/` (Laravel API) + `frontend/` (React + Vite SPA), each with its own `tests/` mirroring source (Principle VII).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the workspace is ready. This feature adds **zero** dependencies (Principle I) — no `npm install` / `composer require`.

- [ ] T001 Confirm no new dependencies are added (no edits to `backend/composer.json` or `frontend/package.json` require blocks) and ensure the `backend/app/Enums/` namespace directory exists for the new enum.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the single authoritative role definition per stack (FR-012 / SC-006). These are the shared vocabulary the cast, the payload, the ordering tests, and the bootstrap command all depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 [P] Create the backend enum `App\Enums\Role` in `backend/app/Enums/Role.php`: `enum Role: string` with cases `Guest='guest'`, `Member='member'`, `Admin='admin'`, `Superuser='superuser'`; methods `rank(): int` (0/1/2/3), `outranks(self $other): bool` (`rank() > $other->rank()`, equal ⇒ false), `static assignable(): array` (member/admin/superuser only, no guest), `static tryFromAssignable(string $value): ?self` (rejects `guest` and out-of-set). Use small `match` expressions, no closures; `declare(strict_types=1)`, PSR-12, methods <30 lines (per contracts/role.md).
- [ ] T003 [P] Create the frontend mirror `Role` class in `frontend/src/lib/role.ts`: export `type RoleName = 'guest' | 'member' | 'admin' | 'superuser'` and a `static`-method class `Role` with `readonly ORDER: readonly RoleName[]` (`['guest','member','admin','superuser']`), `rank(role): number`, `outranks(a, b): boolean` (equal ⇒ false), `isAssignable(role): boolean` (false for guest). Switch/lookup only, no closures; 2-space, semicolons (per contracts/frontend.md).

**Checkpoint**: The authoritative role vocabulary exists on both stacks — user stories can now proceed.

---

## Phase 3: User Story 1 - Every account carries exactly one role (Priority: P1) 🎯 MVP

**Goal**: Every account has exactly one role from {member, admin, superuser}; new registrations default to **member**; pre-existing rows backfill to **member**; role can never be set by a request body (not mass-assignable).

**Independent Test**: Build/register a new account → it reports role **member**; run the migration on a DB with legacy rows → they read **member**; attempt `User::create(['role' => 'superuser', ...])` → role stays **member** (non-fillable).

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T004 [P] [US1] Create `backend/tests/Unit/Models/UserTest.php`: a newly built/created user has `role === Role::Member` (FR-004, SC-002); mass-assigning `['role' => 'superuser']` does **not** set it (non-fillable, Principle VI); the `role` attribute is cast to a `Role` instance; an `unverified()` user still has `role === Role::Member` (role is independent of e-mail verification — FR-011).

### Implementation for User Story 1

- [ ] T005 [US1] Create migration `backend/database/migrations/2026_07_08_000001_add_role_to_users_table.php`: add `string('role')->default('member')` `NOT NULL` after `password` (defaults new rows + backfills legacy rows in one DDL — FR-004/FR-010); reversible `down()` drops the column. Plain string, no MySQL `ENUM`/`CHECK` (portable to SQLite `:memory:` — research D3).
- [ ] T006 [US1] Edit `backend/app/Models/User.php`: cast `'role' => Role::class` in `casts()`; add default attribute `role => Role::Member->value`; keep `role` **out of** `$fillable` (privilege-escalation guard, Principle VI / research D5).
- [ ] T007 [US1] Edit `backend/database/factories/UserFactory.php`: default `role => Role::Member->value`; add `admin()` and `superuser()` states (used here and by US2/US3/US4 tests). Leave `unverified()`/other states untouched (role is independent of verification — FR-011).

**Checkpoint**: US1 fully functional — `php artisan test --filter=UserTest` passes; migration applies cleanly.

---

## Phase 4: User Story 2 - The current viewer's role is knowable (Priority: P1)

**Goal**: The account's role rides on every account payload (`/api/user`, register, login); the frontend maps it onto `AuthUser` and the auth context exposes the **effective role** — `guest` when logged out, the stored role when logged in.

**Independent Test**: Register/login → payload includes `"role": "member"`; anonymous `GET /api/user` stays `{ "data": null }`; in the SPA the auth context reports `role: 'guest'` when logged out and the user's stored role when logged in.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T008 [P] [US2] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`: register (201) payload includes `"role": "member"`; `GET /api/user` for a logged-in account includes its `role`; anonymous `GET /api/user` stays `{ "data": null }` (FR-006 handled client-side).
- [ ] T009 [P] [US2] Extend `frontend/tests/lib/authApi.test.ts`: `AuthApi.mapUser` copies `role` through from the raw payload (`data.role` → `AuthUser.role`).
- [ ] T010 [P] [US2] Extend `frontend/tests/components/AuthProvider.test.tsx`: the context `role` is `'guest'` when anonymous and equals the user's stored role when authenticated (member/admin/superuser); stays `'guest'` while `status === 'unknown'`.

### Implementation for User Story 2

- [ ] T011 [US2] Edit `backend/app/Http/Resources/UserResource.php`: add `'role' => $this->role->value` (FR-007). No other field is reshaped.
- [ ] T012 [US2] Edit `frontend/src/lib/authApi.ts`: add `role: RoleName` to `AuthUser` and `RawUser` (import `RoleName` from `./role`); `AuthApi.mapUser` maps `role: raw.role`.
- [ ] T013 [US2] Edit `frontend/src/hooks/useAuth.ts`: `AuthContextValue` gains `role: RoleName`.
- [ ] T014 [US2] Edit `frontend/src/components/AuthProvider.tsx`: derive effective role `user?.role ?? 'guest'` and include it in the memoised context value alongside `status`/`user`.

**Checkpoint**: US1 + US2 both work — payload carries role; context exposes effective role (guest vs stored).

---

## Phase 5: User Story 3 - Roles are ordered so "outranks" can be answered (Priority: P2)

**Goal**: The ordering `guest < member < admin < superuser` and the `outranks` comparison are verified and locked on both stacks via the exhaustive 16-pair matrix (SC-004). (The primitive itself was built in Foundational; this story proves and pins its contract.)

**Independent Test**: For every ordered pair of roles, `outranks` matches the matrix in data-model.md, and equal-rank pairs return `false` — 100% agreement across all 16 pairs, on both backend and frontend.

### Tests for User Story 3 ⚠️

- [ ] T015 [P] [US3] Create `backend/tests/Unit/Enums/RoleTest.php`: assert `rank()` is 0/1/2/3; the full 16-pair `outranks` matrix incl. equal-rank ⇒ `false` (SC-004); `assignable()` is exactly {Member, Admin, Superuser} (no Guest); `tryFromAssignable('guest')` and `('nope')` ⇒ `null`, `('admin')` ⇒ `Role::Admin`.
- [ ] T016 [P] [US3] Create `frontend/tests/lib/role.test.ts`: mirror the 16-pair `outranks` matrix, the `rank()` values, `ORDER`, and `isAssignable('guest') === false` / `true` for member/admin/superuser.

**Checkpoint**: The "outranks" primitive is exhaustively verified identically on both stacks.

---

## Phase 6: User Story 4 - A first superuser can be established (Priority: P2)

**Goal**: An operator can promote a chosen account to **superuser** by email via an artisan command that is not reachable as an in-app HTTP request (FR-009).

**Independent Test**: From a system of default members, run `php artisan user:make-superuser ada@example.com` → that account reports `superuser` (SC-005); unknown email → non-zero exit, no change; already-superuser → idempotent success; no HTTP route performs this.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T017 [P] [US4] Create `backend/tests/Feature/Console/MakeSuperuserCommandTest.php`: promoting a member by email sets `role = Role::Superuser` and exits `0` (SC-005); unknown email prints an error, changes nothing, exits non-zero; already-superuser is idempotent (exit `0`, no spurious change).

### Implementation for User Story 4

- [ ] T018 [US4] Create `backend/app/Console/Commands/MakeSuperuserCommand.php` (signature `user:make-superuser {email}`): find the account by **email** (not a DB id); set `role` to `Role::Superuser`, persist, print confirmation, exit `SUCCESS`; unknown email ⇒ error + `FAILURE`; already-superuser ⇒ idempotent success. Thin handler modelled on `SeedMediaCommand`; PSR-12, `declare(strict_types=1)`.

**Checkpoint**: All four stories independently functional; the hierarchy can be bootstrapped.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the gates and validate end-to-end.

- [ ] T019 [P] Run backend lint + tests + coverage through Docker: `docker compose exec backend vendor/bin/pint --test` and `docker compose exec backend php artisan test --coverage` — confirm ≥90% line coverage (Principle VII) and all new/edited tests green.
- [ ] T020 [P] Run frontend lint + tests + coverage: `cd frontend && npm run lint && npm run test -- --coverage` — confirm ESLint clean and Vitest coverage ≥90% over all of `src/`.
- [ ] T021 Run the quickstart.md validation: apply the migration, confirm legacy rows read `member`, and smoke `user:make-superuser` (promote → idempotent re-run → unknown-email failure) per specs/009-user-roles/quickstart.md.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — the `Role` enum and `lib/role.ts` are prerequisites for the cast (US1), the payload/types (US2), the matrix tests (US3), and the command (US4).
- **User Stories (Phase 3–6)**: All depend on Foundational.
  - US1 (P1) depends only on Foundational.
  - US2 (P1): frontend tasks depend only on Foundational (`lib/role.ts`); the backend `AuthControllerTest` (T008) depends on US1's model default + factory states (T006/T007).
  - US3 (P2) depends only on Foundational (tests target the enum/`Role` class directly).
  - US4 (P2) depends on Foundational (`Role::Superuser`) and US1's model/factory (T006/T007) to promote a member.
- **Polish (Phase 7)**: Depends on all desired stories being complete.

### Within Each User Story

- Tests are written first and must FAIL before implementation.
- Backend: migration → model → factory; then resource. Frontend: `authApi.ts` (types) → `useAuth.ts` → `AuthProvider.tsx`.

### Parallel Opportunities

- **Foundational**: T002 (backend enum) and T003 (frontend class) are independent — run in parallel.
- **US1**: T004 (test) can be written in parallel with nothing blocking it; T005/T006/T007 touch different files (migration / model / factory) and can largely proceed together after the test.
- **US2**: the three test tasks T008/T009/T010 are different files — parallel. Backend T011 is independent of frontend T012–T014.
- **US3**: T015 (backend) and T016 (frontend) are fully parallel.
- **US4**: T017 (test) before T018 (command).
- **Polish**: T019 (backend) and T020 (frontend) run in parallel.

---

## Parallel Example: Foundational + US3

```bash
# Foundational — both authoritative definitions at once:
Task: "Create App\\Enums\\Role in backend/app/Enums/Role.php"
Task: "Create Role class in frontend/src/lib/role.ts"

# US3 — mirror the 16-pair matrix on both stacks at once:
Task: "Create backend/tests/Unit/Enums/RoleTest.php"
Task: "Create frontend/tests/lib/role.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 — both P1)

1. Phase 1: Setup.
2. Phase 2: Foundational (the role vocabulary — CRITICAL, blocks everything).
3. Phase 3: US1 (role on every account, default member, non-mass-assignable).
4. Phase 4: US2 (role knowable — on payload + auth context effective role).
5. **STOP and VALIDATE**: register/login shows `role: member`; context reports guest/stored role.

### Incremental Delivery

1. Setup + Foundational → vocabulary ready.
2. US1 → US2 (the two P1 stories) → the role backbone is observable end-to-end (MVP).
3. US3 → the ordering is exhaustively verified on both stacks.
4. US4 → the first superuser can be bootstrapped.
5. Polish → coverage gates + quickstart validation.

---

## Notes

- [P] = different files, no incomplete dependencies.
- Zero new dependencies (Principle I) — native PHP enum + Eloquent casting + artisan console; one in-house frontend class.
- `role` stays out of `$fillable`; the only writer of a raised role is the operator CLI (no HTTP route — FR-009 / OOS-002).
- No new user-facing route or behaviour → no Playwright e2e added (research D6); correctness lives in the unit/feature/Vitest tests above.
- **FR-010 (legacy-row backfill) is validated manually in T021, not by the automated suite**: tests run on a fresh `sqlite :memory:` DB built by `RefreshDatabase`, so no pre-existing row without a role can exist to exercise the column-default backfill. The column `DEFAULT 'member'` is the mechanism; T021's quickstart run against a populated DB is its coverage.
- Verify each test fails before implementing; commit after each task or logical group.
