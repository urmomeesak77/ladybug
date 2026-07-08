# Quickstart & Validation: User Roles (Backbone)

Runnable checks that prove the role backbone works end-to-end. Backend runs
through the Dockerised PHP (no local PHP); frontend through the usual Vite/Vitest
toolchain. References: [plan.md](./plan.md), [data-model.md](./data-model.md),
[contracts/role.md](./contracts/role.md), [contracts/frontend.md](./contracts/frontend.md).

## Prerequisites

- Backend deps installed; migrations runnable on SQLite `:memory:` (tests) and
  MySQL (dev). Frontend deps installed.
- Dockerised PHP for artisan/tests (project convention): `php:8.3-cli` container
  or `docker compose exec backend …`.

## Backend

### Apply the schema

```bash
docker compose exec backend php artisan migrate
```

Expected: the `add_role_to_users_table` migration runs; `users` now has a
`role` column, `NOT NULL DEFAULT 'member'`. Every pre-existing account now reads
`role = member` (FR-010, SC-001).

### Run the backend tests + coverage gate

```bash
docker compose exec backend php artisan test
# coverage (≥90% gate, Principle VII):
docker compose exec backend php artisan test --coverage
```

Expected to pass:
- **`RoleTest`** — `rank()` is 0/1/2/3; the full 16-pair `outranks` matrix
  matches [data-model.md](./data-model.md) incl. equal-rank ⇒ `false` (SC-004);
  `assignable()` is exactly {member, admin, superuser} (no guest);
  `tryFromAssignable('guest' | 'nope')` ⇒ `null`, `('admin')` ⇒ `Role::Admin`.
- **`UserTest`** — a newly built/created user has `role === Role::Member` (FR-004,
  SC-002); mass-assigning `['role' => 'superuser']` does **not** set it
  (non-fillable, Principle VI).
- **`MakeSuperuserCommandTest`** — promotes a member by email to superuser (SC-005);
  unknown email ⇒ failure exit, no change; already-superuser ⇒ idempotent success.
- **`AuthControllerTest`** — register 201 payload includes `"role": "member"`;
  `GET /api/user` for a logged-in account includes its `role`; anonymous
  `GET /api/user` stays `{ "data": null }` (FR-006 handled client-side).

### Seed the first superuser (FR-009, SC-005)

```bash
docker compose exec backend php artisan user:make-superuser ada@example.com
```

Expected: prints confirmation, exit `0`; `ada@example.com` now reports
`role = superuser`. Re-running is idempotent. An unknown email prints an error
and exits non-zero. There is **no** HTTP route that does this (operator-only).

## Frontend

### Run Vitest + coverage (gate spans all of `src/`)

```bash
cd frontend
npm run test
npm run test -- --coverage
```

Expected to pass:
- **`lib/role.test.ts`** — the 16-pair `outranks` matrix (mirror of the backend),
  `rank()` values, `isAssignable('guest') === false` and `true` for the rest.
- **`lib/authApi.test.ts`** — `mapUser` copies `role` through from the raw payload.
- **`components/AuthProvider.test.tsx`** — context `role` is `'guest'` when
  anonymous (US2) and equals the user's stored role when authenticated.

## Manual smoke (optional)

1. `docker compose up` the dev stack. As a **logged-out** browser, the site
   behaves exactly as before — no visible change (role is not yet gated, OOS-001).
2. Log in; open the network tab on the `/api/user` (or login) response — it now
   carries `"role": "member"`. In React devtools the auth context exposes
   `role: 'member'`; logged out it exposes `role: 'guest'`.
3. Run `user:make-superuser` against your account, re-log-in, and confirm the
   payload/context now shows `"role": "superuser"`.

## Success criteria mapping

| Check | Criterion |
|-------|-----------|
| Migration backfills existing rows to member | SC-001, FR-010 |
| Register payload `role: member` | SC-002, FR-004 |
| Anonymous ⇒ effective role guest; authenticated ⇒ stored role | SC-003, FR-006 |
| 16-pair `outranks` matrix (both stacks) | SC-004, FR-002/FR-008 |
| `user:make-superuser` seeds first superuser | SC-005, FR-009 |
| One authoritative role definition per stack | SC-006, FR-012 |
