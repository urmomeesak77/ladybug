# Quickstart: Admin User List

**Feature**: 012-admin-user-list | **Date**: 2026-07-20

How to run and validate this feature end-to-end. Details live in
[contracts/admin-users-api.md](./contracts/admin-users-api.md) and
[data-model.md](./data-model.md) — this file only says how to prove it works.

## Prerequisites

- Docker Desktop running. **There is no local PHP** — every backend command goes through a
  container (project convention).
- The stack up: `docker compose up -d` from the repo root.
- The migration applied:
  `docker compose exec backend php artisan migrate`
- At least one superuser and one admin. Bootstrap a superuser with
  `docker compose exec backend php artisan make:superuser`, then register ordinary accounts
  through the SPA at `/register`.

## Automated verification

Run these before calling anything done — evidence, not assertions.

```powershell
# Backend: lint, then the full suite with the ≥90% Clover gate
docker compose exec backend vendor/bin/pint --test
docker compose exec backend php artisan test
docker compose exec backend php artisan test --coverage-clover coverage.xml
python .github/scripts/check_coverage.py coverage.xml

# Frontend: lint + unit/component tests with coverage over ALL of src/
cd frontend
npm run lint
npm run test -- --coverage

# The browser slice (boots the isolated e2e stack)
docker compose -f docker-compose.e2e.yml up -d
npx playwright test tests/e2e/users.spec.ts
```

Targeted suites while iterating:

```powershell
docker compose exec backend php artisan test --filter=UserAdmin
docker compose exec backend php artisan test --filter=EnsureAccountEnabled
cd frontend; npm run test -- userAdmin
```

**Note on the migration**: backend tests run on SQLite `:memory:` and never touch a real
database. `MigrationReversibilityTest` exercises `down()`, so the new migration must drop the
foreign key before the columns.

## Manual validation scenarios

Sign in as an admin at `http://localhost:5173` unless stated otherwise.

### S1 — Browse the list (US1)

1. Open `/admin/users`.
2. **Expect**: a table of every account, newest first, with columns name, e-mail, role,
   verified, created, disabled, and an action cell.
3. **Expect**: an unverified account reads "not verified" in words, not by colour alone.
4. Click page link 2. **Expect**: the URL becomes `/admin/users?page=2` and the table changes.
5. Refresh, then press Back. **Expect**: page 2 restores, then page 1 — no blank state.
6. Visit `/admin/users?page=9999`. **Expect**: an empty/last-page state, not an error.

### S2 — The access boundary (US2)

| As | Do | Expect |
|---|---|---|
| Signed out | open `/admin/users` | redirected away; `GET /api/admin/users` answers `401` |
| Member | open `/admin/users` | redirected away; the API answers `403` |
| Member | look at the left menu | no "Users" entry |
| Admin | look at the left menu | "Users" entry present and working |

Check the API directly, not just the page — the boundary must protect the data:

```powershell
curl -i http://localhost:8000/api/admin/users        # 401 with no session
```

### S3 — Disable and re-enable (US3)

1. As an admin, click **Disable** on a member row.
2. **Expect**: one click, no confirmation dialog; the row now shows disabled, with the
   timestamp and your account name; you stay on the same page and no other row changes.
3. In a second browser (or private window), try to sign in as that member.
   **Expect**: refusal with *"This account is disabled."* — visibly different from the
   wrong-password message.
4. Have that member signed in *before* you disable them, then make them click anything.
   **Expect**: their next request fails and the SPA drops to the logged-out UI.
5. Click **Enable** on the row. **Expect**: the row reads active with an empty disabled cell,
   and that member can sign in again with the **same** password — no re-verification.
6. Disable then enable the same account twice. **Expect**: it lands cleanly active with no
   leftover "disabled by" text.

### S4 — Peers and higher ranks are protected (US4)

As an **admin**:

1. Find another admin's row, a superuser's row, and your own row.
2. **Expect**: none of the three offers a control; each shows a short textual reason instead.
3. Force the request anyway — the server must refuse regardless of the UI:

   ```powershell
   # with an admin session cookie, targeting another admin's hash
   curl -i -X POST http://localhost:8000/api/admin/users/<ADMIN_HASH>/disable
   ```

   **Expect**: `403`, and that account unchanged when you reload the list.

As a **superuser**: admins and members can be acted on; another superuser cannot.

### S5 — Content and rating are untouched (FR-010a)

1. Note a member's memes in `/admin/trashposts` and the rating shown on their rows.
2. Disable that member.
3. **Expect**: their memes are still live on the public feed, still activated, and their
   rating is unchanged. Disabling revokes access only — takedown stays the moderation
   console's job.

### S6 — Theme, accessibility, responsive (Principles IV/VIII)

1. Toggle the OS between light and dark. **Expect**: the page follows.
2. Narrow the viewport to 320px. **Expect**: the **page** never scrolls horizontally — only
   the table scrolls, inside its own container. No clipped controls.
3. Tab through a row. **Expect**: the action control is reachable and announces a clear name
   ("Disable"/"Enable").

## Definition of done

- All automated commands above pass, with coverage ≥90% on both stacks.
- S1–S6 verified by hand (the constitution requires manual verification for navigation,
  theming, and layout changes).
- No new npm or Composer dependency appears in either lockfile.
