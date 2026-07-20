---
description: "Task list for feature implementation"
---

# Tasks: Admin User List

**Input**: Design documents from `/specs/012-admin-user-list/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/admin-users-api.md](./contracts/admin-users-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. Constitution Principle VII makes ≥90% line coverage on both
stacks a binding, CI-enforced gate, and plan.md names the mirrored test files explicitly — so
tests are a requirement of this feature, not an option. Write each test before its implementation
and confirm it fails first (superpowers:test-driven-development).

**Organization**: Tasks are grouped by user story. All four stories are P1 (the spec ships them
together), but they are ordered so each phase leaves the tree in a working, independently
verifiable state.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are given in every task

## Path Conventions

Decoupled two-app layout (plan.md → Project Structure): `backend/` is the Laravel 12 API,
`frontend/` is the React 18 + Vite SPA. Each stack's `tests/` mirrors its source paths.

**Backend commands run through Docker — there is no local PHP** (project convention):
`docker compose exec backend php artisan test`, `docker compose exec backend vendor/bin/pint --test`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the working baseline before changing anything. No dependency is added by
this feature (Principle I), so there is nothing to install.

- [X] T001 Confirm the stack runs and the existing suites are green before any edit: `docker compose up -d`, then `docker compose exec backend vendor/bin/pint --test`, `docker compose exec backend php artisan test`, and `cd frontend; npm run lint; npm run test` — record the passing output as the baseline
- [X] T002 Re-read the binding gates that constrain this feature: `.specify/memory/constitution.md` and `docs/CODING_CONVENTIONS.md` (PSR-12 + `declare(strict_types=1)` + PHP functions < 30 lines; 2-space TS, semicolons, `lib/` modules as single classes of `static` methods)

**Checkpoint**: Baseline green; no lockfile in either stack will change for the rest of this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema, model surface, test factory state, and shared paging extraction that
every user story below builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first, confirm failing)

- [X] T003 [P] Extend `backend/tests/Feature/Database/SchemaTest.php` with assertions that `users` has nullable `disabled_at` and `disabled_by` columns, both defaulting to null (data-model §1)
- [X] T004 [P] Add a `User::isDisabled()` / `disabledBy()` unit test in `backend/tests/Unit/Models/UserTest.php` covering: null `disabled_at` ⇒ false, set ⇒ true, `disabled_at` cast to a datetime, and `disabledBy` resolving to the acting user and to null (data-model INV-3 "unresolvable actor")
- [X] T005 [P] Add a test in `backend/tests/Unit/Models/UserTest.php` asserting neither `disabled_at` nor `disabled_by` appears in `User::$fillable`, so no request body can reach them (data-model INV-2, Principle VI)
- [X] T006 [P] Add `frontend/tests/lib/adminPaging.test.ts` covering `AdminPaging.parsePage` (absent, non-numeric, `0`, negative, valid ⇒ fallback to 1 where required) and `AdminPaging.pageLinks` (single page, first page, middle, last page) per research D8

### Implementation

- [X] T007 Create the migration `backend/database/migrations/2026_07_20_000002_add_disabled_to_users_table.php` adding nullable `disabled_at` (timestamp) and nullable `disabled_by` (`foreignId` → `users.id`, `nullOnDelete`); `down()` MUST drop the foreign key before dropping the columns, and the whole migration must run on SQLite `:memory:` because tests never touch a real database
- [X] T008 Update `backend/app/Models/User.php`: cast `disabled_at` to `datetime`, add `disabledBy(): BelongsTo` (self-reference on `disabled_by`), add `isDisabled(): bool`; leave both columns out of `$fillable`
- [X] T009 [P] Add a `disabled()` state to `backend/database/factories/UserFactory.php` that sets `disabled_at` and accepts an optional acting user for `disabled_by`, so every later test can build disabled accounts
- [X] T010 [P] Create `frontend/src/lib/adminPaging.ts` — class `AdminPaging` with the `PageMeta` type plus `static parsePage` and `static pageLinks`, moved verbatim from `moderationModel.ts` (research D8)
- [X] T011 [P] Create `frontend/src/components/admin/AdminPagination.tsx` — the shared numbered page-link component (props `meta`, `label`), with `aria-current` on the active page, extracted from `ModerationPagination.tsx`
- [X] T012 Rewrite `frontend/src/lib/moderationModel.ts` `pageLinks`/`parsePage` as thin delegations to `AdminPaging`, keeping the existing names and signatures so no 010 caller or test changes (research D8 — the extraction is additive)
- [X] T013 Rewrite `frontend/src/components/moderation/ModerationPagination.tsx` as a thin wrapper over `AdminPagination`, preserving its current props and rendered markup; run `cd frontend; npm run test -- moderation` and confirm the shipped 010 tests still pass unchanged
- [X] T014 Run `docker compose exec backend php artisan migrate` and `docker compose exec backend php artisan test --filter=Schema` and confirm T003–T005 now pass

**Checkpoint**: Schema, model, factory, and shared paging ready — user stories can begin.

---

## Phase 3: User Story 1 - Browse the account list (Priority: P1) 🎯 MVP

**Goal**: An admin opens `/admin/users` and sees every registered account newest-first, 100 per
page, with name, e-mail, role, verified, created and disabled columns, on a real bookmarkable
`?page=N` URL.

**Independent Test**: Sign in as an admin, open `/admin/users`, confirm every account appears with
all six columns populated in newest-first order, click through the page links, and confirm the URL
reflects the page and a refresh restores it.

### Tests for User Story 1 (write first, confirm failing)

- [X] T015 [P] [US1] Create `backend/tests/Unit/Http/Resources/AdminUserResourceTest.php`: asserts the exact key set (`hash`, `name`, `email`, `role`, `email_verified_at`, `created_at`, `disabled_at`, `disabled_by`), `Y-m-d H:i:s` formatting, explicit `null` (never omitted keys), `disabled_by` serialized as the actor's **name** not an id, and that `id`, `password`, `remember_token`, `email_sha1` and `rating` never appear (contract §1, data-model INV-3)
- [X] T016 [P] [US1] Create `backend/tests/Unit/Services/UserAdminServiceTest.php` paging cases: newest-first `created_at DESC, id DESC` ordering, 100 per page, every account state included (unverified, disabled, every role), `disabledBy` eager-loaded (no N+1 across the page), and a page beyond the last returning an empty page rather than an error
- [X] T017 [P] [US1] Create `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php` with the `GET /api/admin/users` cases: 200 payload shape and `meta` block, `?page=2` returning the second page, and non-numeric / missing / `<1` page falling back to page 1 (contract §1)
- [X] T018 [P] [US1] Create `frontend/tests/lib/userAdminModel.test.ts` covering the `RawUserRow` → `UserRow` mapping (snake_case → camelCase), derived `isDisabled`, the verified/disabled display labels, and `replaceRow` swapping one row in place while leaving the rest identical
- [X] T019 [P] [US1] Create `frontend/tests/hooks/useUserAdmin.test.tsx` covering the `?page`-driven fetch, the loading → loaded transition, page changes refetching, and a failed fetch surfacing a distinct error state (never an empty-list state)
- [X] T020 [P] [US1] Create `frontend/tests/components/users/UserTable.test.tsx` and `frontend/tests/components/users/UserRow.test.tsx`: all seven columns render, "not verified" is conveyed in **text** not colour alone, a disabled row shows its timestamp and the acting account's name, a disabled row with an unresolvable actor degrades to the timestamp alone, and the table sits inside an `overflow-x: auto` scroll container
- [X] T021 [P] [US1] Create `frontend/tests/pages/UserAdminPage.test.tsx` covering the loaded table, the explicit empty state (FR-017), the error + retry state, and page links reflecting `?page=N`

### Implementation for User Story 1

- [X] T022 [P] [US1] Create `backend/app/Http/Resources/AdminUserResource.php` — the admin-only row projection from data-model §3, formatting datetimes as `Y-m-d H:i:s` and exposing `disabled_by` as `$this->disabledBy?->name`
- [X] T023 [US1] Create `backend/app/Services/UserAdminService.php` with `paginate(int $page): LengthAwarePaginator` — `User::with('disabledBy')->orderByDesc('created_at')->orderByDesc('id')->paginate(100, ['*'], 'page', $page)` (research D7)
- [X] T024 [US1] Create `backend/app/Http/Controllers/Admin/UserAdminController.php` with `index(Request $request)` returning `AdminUserResource::collection(...)`, reading and normalising `?page` (research D7, contract §1)
- [X] T025 [US1] Register `GET /api/admin/users` in `backend/routes/api.php` inside the existing `auth:sanctum` + `role:admin` group (research D10)
- [X] T026 [P] [US1] Create `frontend/src/lib/userAdminModel.ts` — class `UserAdminModel` with the `RawUserRow`/`UserRow` types plus `static toRow`, the display-label helpers, and `static replaceRow`
- [X] T027 [P] [US1] Create `frontend/src/lib/userAdminApi.ts` — class `UserAdminApi` with `static fetchPage(page)` calling `GET /api/admin/users`, credentials included, mapping the payload through `UserAdminModel`
- [X] T028 [US1] Create `frontend/src/hooks/useUserAdmin.ts` — reads `?page` from the URL, fetches through `UserAdminApi`, exposes rows, `PageMeta`, loading and error state, and an in-place row replacement callback
- [X] T029 [P] [US1] Create `frontend/src/components/users/UserRow.tsx` — one `<tr>` with the seven cells; verified and disabled states in text, disabled cell showing timestamp + actor name (or the timestamp alone when the actor is unresolvable)
- [X] T030 [US1] Create `frontend/src/components/users/UserTable.tsx` — captioned table with `scope="col"` headers inside an `overflow-x: auto` scroll container, rendering `UserRow` keyed by `hash`
- [X] T031 [US1] Create `frontend/src/pages/UserAdminPage.tsx` — site layout + `UserTable` + `AdminPagination`, with the explicit empty state (FR-017) and a distinct error + retry state
- [X] T032 [US1] Add the user-table styles to `frontend/src/styles/theme.css`, mirroring the `.moderation-table__scroll` pattern so the table scrolls independently and the page never scrolls horizontally at 320px (Principle VIII)
- [X] T033 [US1] Verify: `docker compose exec backend php artisan test --filter=UserAdmin` and `cd frontend; npm run test -- userAdmin` both pass with real output

**Checkpoint**: The list renders and pages correctly for an admin — MVP is demoable.

---

## Phase 4: User Story 2 - Restrict the list to admins and above (Priority: P1)

**Goal**: Guests and members can reach neither the page nor the data behind it, and see no
navigation entry for it.

**Independent Test**: Request `/admin/users` and `GET /api/admin/users` as a guest, a member, an
admin and a superuser; confirm only admin and superuser succeed, and that the nav link appears
only for admin+.

### Tests for User Story 2 (write first, confirm failing)

- [X] T034 [P] [US2] Add access-boundary cases to `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php`: guest ⇒ `401`, member ⇒ `403`, admin ⇒ `200`, superuser ⇒ `200`, applied to **all three** endpoints (contract §"Shared access boundary")
- [X] T035 [P] [US2] Add a test to `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php` asserting no e-mail or role field leaks into any public or member-facing payload as a side effect of this feature (FR-018) — assert against the public feed and single-post responses
- [X] T036 [P] [US2] Extend `frontend/tests/components/LeftMenu.test.tsx` — the "Users" entry is absent for a guest and for a member, present for an admin and a superuser (FR-003)
- [X] T037 [P] [US2] Extend `frontend/tests/App.test.tsx` — `/admin/users` is wrapped in `RequireRole role="admin"` and a member is redirected away

### Implementation for User Story 2

- [X] T038 [US2] Confirm (and adjust if needed) that all three routes in `backend/routes/api.php` sit inside the `auth:sanctum` + `role:admin` group so the guest→401 / member→403 boundary is inherited with no new middleware
- [X] T039 [P] [US2] Add the admin-only "Users" entry linking to `/admin/users` in `frontend/src/components/LeftMenu.tsx`, gated on the viewer's role exactly as the existing moderation entry is
- [X] T040 [US2] Register the `/admin/users` route in `frontend/src/App.tsx` wrapped in `<RequireRole role="admin">`
- [X] T041 [US2] Verify with real output: `docker compose exec backend php artisan test --filter=UserAdmin` plus `curl -i http://localhost:8000/api/admin/users` with no session returning `401`

**Checkpoint**: The data boundary — not just the page — is enforced and proven.

---

## Phase 5: User Story 3 - Disable and re-enable an account (Priority: P1)

**Goal**: A single-click Disable/Enable per row that revokes or restores access, refuses sign-in
for disabled accounts, kills their live sessions on the next request, and changes nothing else.

**Independent Test**: As an admin, disable a member account, confirm that account can no longer
sign in and that a live session for it stops working on its next request; enable it and confirm
sign-in works again with the original credentials.

### Tests for User Story 3 (write first, confirm failing)

- [X] T042 [P] [US3] Add transition cases to `backend/tests/Unit/Services/UserAdminServiceTest.php`: disable sets `disabled_at` **and** `disabled_by` together; enable clears **both** together; disabling an already-disabled account is a no-op that keeps the original timestamp and actor; enabling an active account is a no-op (data-model §2, research D10 — set-to-target, not toggle)
- [X] T043 [P] [US3] Add an invariant test to `backend/tests/Unit/Services/UserAdminServiceTest.php` asserting disable/enable changes nothing else — not `role`, `email`, `email_verified_at`, `password` or `rating`, and no owned `trashposts` row's activation or visibility (FR-010/FR-010a, research D9)
- [X] T044 [P] [US3] Add endpoint cases to `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php`: `POST /api/admin/users/{hash}/disable` and `/enable` each returning `200` with the updated row in the §1 shape, `404` for an unknown hash, and rejecting any attempt to address a row by database id (FR-020)
- [X] T045 [P] [US3] Create `backend/tests/Feature/Http/Middleware/EnsureAccountEnabledTest.php`: a disabled user's next `/api/*` request answers `401 {"message":"This account is disabled."}` with the session invalidated and the cookie unusable on replay; the same holds for `POST /api/logout`, which answers `401` with the session already invalidated rather than its usual success (research D3); an active user passes through; an unauthenticated request passes through untouched
- [X] T046 [P] [US3] Add sign-in cases to `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`: wrong credentials still return the existing generic `401`; correct credentials on a disabled account return `403 {"message":"This account is disabled."}` **with no session left behind**; the disabled check runs only after credentials verify, so login is not an account-state oracle (research D4); and an account that was disabled and then enabled signs in successfully with its **original** password, returning `200` and a working session — no re-registration and no re-verification (FR-015, SC-006)
- [X] T047 [P] [US3] Create `frontend/tests/components/users/UserActions.test.tsx`: an active row offers exactly **Disable**, a disabled row exactly **Enable**, one click with no confirmation step, and the control carries an accessible name
- [X] T048 [P] [US3] Extend `frontend/tests/hooks/useUserAdmin.test.tsx`: a successful action replaces that row in place and keeps the current page; a failed action leaves the row exactly as it was (contract §5 — never paint state the server did not confirm)

### Implementation for User Story 3

- [X] T049 [US3] Add `disable(User $actor, string $hash)` and `enable(User $actor, string $hash)` to `backend/app/Services/UserAdminService.php`, both delegating to a shared private `transition()` that loads the target fresh inside a DB transaction and writes only `disabled_at`/`disabled_by` — keeping every method under the 30-line PHP budget
- [X] T050 [US3] Add `disable` and `enable` actions to `backend/app/Http/Controllers/Admin/UserAdminController.php`, taking the actor from `$request->user()` and never from the request body (FR-008b), returning the updated `AdminUserResource`
- [X] T051 [US3] Register `POST /api/admin/users/{hash}/disable` and `POST /api/admin/users/{hash}/enable` in `backend/routes/api.php` inside the same admin group (research D10)
- [X] T052 [P] [US3] Create `backend/app/Http/Middleware/EnsureAccountEnabled.php` — pass through when no user resolves or the user is active; otherwise log out the `web` guard, invalidate the session, regenerate the CSRF token, and return `401 {"message":"This account is disabled."}` (research D3)
- [X] T053 [US3] Append `EnsureAccountEnabled` to the **api** middleware group in `backend/bootstrap/app.php`, after `statefulApi()` so the session is started and `$request->user()` resolves before it runs
- [X] T054 [US3] Update `login` in `backend/app/Http/Controllers/AuthController.php` — keep `Auth::attempt()` **first**, then check `isDisabled()`; if disabled, log the just-established session out and return `403 {"message":"This account is disabled."}` (research D4 — order is the security property here)
- [X] T055 [P] [US3] Add `static disable(hash)` and `static enable(hash)` to `frontend/src/lib/userAdminApi.ts`, POSTing with the `X-XSRF-TOKEN` header via the existing `Csrf` helper and returning the updated mapped row
- [X] T056 [US3] Create `frontend/src/components/users/UserActions.tsx` — exactly one control per row (Disable when active, Enable when disabled), single click, no confirmation, disabled while its request is in flight
- [X] T057 [US3] Wire the action into `frontend/src/hooks/useUserAdmin.ts` and `frontend/src/components/users/UserRow.tsx`: on success replace the returned row in place and stay on page N (FR-016); on failure leave the row untouched and surface the error
- [X] T058 [US3] Verify with real output: `docker compose exec backend php artisan test --filter=UserAdmin`, `--filter=EnsureAccountEnabled`, `--filter=AuthController`, and `cd frontend; npm run test -- userAdmin`

**Checkpoint**: Disable/enable works end to end, including sign-in refusal and live-session revocation.

---

## Phase 6: User Story 4 - Protect peers and higher ranks from edits (Priority: P1)

**Goal**: An actor can only act on accounts ranked **strictly** below their own — peers, higher
ranks and their own account are refused on the server and offer no control in the UI.

**Independent Test**: As an admin, confirm no control appears on another admin's row, a
superuser's row, or the admin's own row, and that a forced `POST` against any of them returns
`403` with the target unchanged; as a superuser, confirm admins and members can be acted on but
another superuser cannot.

### Tests for User Story 4 (write first, confirm failing)

- [X] T059 [P] [US4] Add rank-guard cases to `backend/tests/Unit/Services/UserAdminServiceTest.php`: admin→admin refused, admin→superuser refused, admin→self refused, superuser→superuser refused, admin→member allowed, superuser→admin allowed — and in every refusal the target row is **unchanged** (FR-011, research D5)
- [X] T060 [P] [US4] Add a "role change mid-view" case to `backend/tests/Unit/Services/UserAdminServiceTest.php`: the target's role is raised above the actor's after the page was rendered, and the subsequently submitted action is refused on the **current stored** role, not the stale one (FR-012)
- [X] T061 [P] [US4] Add the "last superuser" case to `backend/tests/Unit/Services/UserAdminServiceTest.php`: the sole remaining superuser cannot be disabled by anyone, because nobody outranks it — asserting the US4 rule already produces this with no special case
- [X] T062 [P] [US4] Add `403` endpoint cases to `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php` for disable and enable against a peer, a higher rank, and the actor's own hash, asserting the target is untouched afterwards
- [X] T063 [P] [US4] Extend `frontend/tests/components/users/UserActions.test.tsx`: no control renders when `Role.outranks(viewerRole, row.role)` is false — for a peer, a higher rank, and the viewer's own row — and a short textual reason renders in its place (research D6)

### Implementation for User Story 4

- [X] T064 [US4] Add the strict-rank guard to `transition()` in `backend/app/Services/UserAdminService.php`: proceed only when `$actor->role->outranks($target->role)`, evaluated inside the transaction against freshly loaded rows; otherwise abort `403` leaving the target unchanged. Because a role never outranks itself, this single comparison delivers the peer, higher-rank and self-lockout guards together (research D5)
- [X] T065 [US4] Gate the control in `frontend/src/components/users/UserActions.tsx` on `Role.outranks(viewerRole, row.role)` — with the viewer's role from `useAuth()` — rendering a short textual reason when it is false. No `can_disable` field is added to the payload; the server re-checks regardless (research D6)
- [X] T066 [US4] Verify with real output that a forced request is refused independently of the UI: with an admin session, `curl -i -X POST http://localhost:8000/api/admin/users/<ADMIN_HASH>/disable` returns `403` and the target is unchanged on reload (quickstart S4)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T067 [P] Create `frontend/tests/e2e/users.spec.ts` — Playwright slice covering the admin browsing `/admin/users`, paging via the URL, disabling a member row, that member being refused at sign-in, and then the admin re-enabling the row and that member signing in again with the same credentials (mirrors the shipped `moderation.spec.ts` shape)
- [ ] T068 [P] Cover the remaining spec edge cases with named tests: empty list, out-of-range page, concurrent action converging without error, repeated disable→enable leaving no residual `disabled_by`, and the three recovery flows of contract §4.3 — registration ⇒ `422`, verification resend ⇒ `401`, and a signed verification link still verifying (`email_verified_at` set) while `disabled_at` stays non-null and sign-in stays refused (spec → Edge Cases)
- [ ] T069 Run the real CI gates and record the output: `docker compose exec backend vendor/bin/pint --test`; `docker compose exec backend php artisan test --coverage-clover coverage.xml`; `python .github/scripts/check_coverage.py coverage.xml`; `cd frontend; npm run lint; npm run test -- --coverage` — both stacks must clear ≥90%
- [ ] T070 Confirm no dependency was added: `git diff master -- backend/composer.json backend/composer.lock frontend/package.json frontend/package-lock.json` must be empty (Principle I)
- [ ] T071 Walk the manual scenarios in [quickstart.md](./quickstart.md) S1–S6 by hand — the constitution requires manual verification for navigation, theming, and layout changes; S6 specifically checks 320px with no horizontal **page** scroll and both colour schemes
- [ ] T072 Update `CLAUDE.md`'s Current State section with a 012 entry describing the admin user console, the `disabled_at`/`disabled_by` columns, and the access-only semantics of disabling
- [ ] T073 Dispatch the `commit-quality-verifier` agent on the staged diff and commit only on PASS (project convention)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks every user story**
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on Phase 2; T034/T035 assert against endpoints US1 and US3 create, so run this phase after US1 for a complete boundary sweep
- **US3 (Phase 5)**: depends on Phase 2 and on US1's service/controller/resource scaffolding (T022–T024)
- **US4 (Phase 6)**: depends on US3 — it guards the transitions US3 introduces
- **Polish (Phase 7)**: depends on all four stories

### Within Each User Story

- Tests are written first and MUST fail before implementation
- Migration/model → resource → service → controller → routes (backend)
- `lib/` → hook → components → page → styles (frontend)

### Parallel Opportunities

- **Phase 2**: T003–T006 all in parallel (four different test files); then T009, T010, T011 in parallel (factory, `adminPaging.ts`, `AdminPagination.tsx` are independent files). T012/T013 are sequential after T010/T011.
- **Phase 3**: T015–T021 all in parallel (seven distinct test files). Implementation: T022 and T026/T027 in parallel across stacks; T023→T024→T025 sequential on the backend; T029→T030→T031→T032 sequential on the frontend.
- **Phase 4**: T034–T037 in parallel; T039 and T040 touch different files.
- **Phase 5**: T042–T048 all in parallel. T052 (middleware) is independent of T049–T051 and of T054; T055 is independent of the backend chain.
- **Phase 6**: T059–T063 all in parallel; T064 and T065 are different stacks.
- **Phase 7**: T067 and T068 in parallel.
- **Cross-stack**: at every phase the backend and frontend halves are separate files and can proceed simultaneously.

---

## Parallel Example: User Story 1

```bash
# All US1 tests together (seven independent files):
Task: "AdminUserResource key-set test in backend/tests/Unit/Http/Resources/AdminUserResourceTest.php"
Task: "UserAdminService paging test in backend/tests/Unit/Services/UserAdminServiceTest.php"
Task: "GET /api/admin/users test in backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php"
Task: "Raw→row mapping test in frontend/tests/lib/userAdminModel.test.ts"
Task: "Page-driven fetch test in frontend/tests/hooks/useUserAdmin.test.tsx"
Task: "Table/row render tests in frontend/tests/components/users/UserTable.test.tsx"
Task: "Page states test in frontend/tests/pages/UserAdminPage.test.tsx"

# Then the independent implementation files:
Task: "AdminUserResource in backend/app/Http/Resources/AdminUserResource.php"
Task: "UserAdminModel in frontend/src/lib/userAdminModel.ts"
Task: "UserAdminApi in frontend/src/lib/userAdminApi.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (blocking)
2. Phase 3 US1 — the list renders and pages
3. **STOP and VALIDATE**: quickstart S1 by hand plus `--filter=UserAdmin` green

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → the list is browsable (MVP, demoable)
3. US2 → the boundary is proven on the data, not just the page
4. US3 → disable/enable, sign-in refusal, live-session revocation
5. US4 → the privilege-escalation guard closes over US3's transitions
6. Polish → e2e, coverage gates, manual quickstart walk

**Shipping note**: all four stories are P1 and the spec ships them together. US3 must not reach
real traffic without US4 — an unguarded transition would let any admin disable every other admin,
the superuser, and themselves.

---

## Notes

- **No dependency may be added** — Principle I makes any new npm/Composer package a decision
  requiring explicit human approval first. This feature is designed to need none (T070 proves it).
- `disabled_at`/`disabled_by` stay out of `$fillable`; only `UserAdminService` writes them.
- `disabled_by` stores a database id and is **never serialized** — the resource exposes the
  actor's name or null (data-model INV-3, Principle V).
- Disabling is **access revocation only**: never call `MediaVisibilityService`,
  `ModerationService`, or `RatingService` from these paths, and never add a `disabled_at`
  condition to a meme query (research D9 — recorded precisely because "surely we should also hide
  their posts" is the tempting wrong move).
- Backend commands run through Docker; PHP edits need `docker compose restart backend` because
  dev opcache runs with `validate_timestamps=0`.
- Commit after each phase, and dispatch `commit-quality-verifier` before each commit.
