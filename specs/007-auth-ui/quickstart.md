# Quickstart & Validation: Authentication (Full-Stack)

Run + validation guide. Backend runs through the `php:8.3-cli` Docker convention (no
local PHP); see [contracts/auth-api.md](./contracts/auth-api.md),
[contracts/routes.md](./contracts/routes.md), and [data-model.md](./data-model.md) for
behavior details (not duplicated here).

## Prerequisites

- Dev stack up (`docker compose up -d`); frontend on `:5173`, backend reachable.
- `laravel/sanctum` installed and config published (Sanctum SPA mode), `bootstrap/app.php`
  uses `$middleware->statefulApi()`, `config/cors.php` has `supports_credentials => true`,
  and `SANCTUM_STATEFUL_DOMAINS` / `SESSION_DOMAIN` set in env (see `.env.example`).
- Restart backend after PHP/config edits (opcache `validate_timestamps=0`):
  `docker compose restart backend`.

## Backend checks (Docker `php:8.3-cli`)

```bash
# Lint
docker compose exec backend vendor/bin/pint --test
# Tests + coverage (must stay ≥90% over app/)
docker compose exec backend php artisan test
docker compose exec backend php -d pcov.enabled=1 vendor/bin/phpunit \
  --coverage-clover backend/coverage.clover
python .github/scripts/check_coverage.py backend/coverage.clover 90
```

API smoke (cookie jar exercises the SPA flow):
```bash
# 1) prime CSRF, 2) register, 3) who-am-i, 4) logout — using a shared cookie jar
curl -s -c jar -b jar http://localhost:8000/sanctum/csrf-cookie -o /dev/null
curl -s -c jar -b jar -H 'Accept: application/json' \
  -H "X-XSRF-TOKEN: $(...read XSRF-TOKEN from jar...)" \
  -d 'name=Ada&email=ada@example.com&password=Password1&password_confirmation=Password1' \
  http://localhost:8000/api/register            # → 201 {data:{id,name,email,...}}
curl -s -c jar -b jar -H 'Accept: application/json' \
  http://localhost:8000/api/user                # → 200 {data:{...ada...}}
curl -s -c jar -b jar -X POST -H "X-XSRF-TOKEN: ..." \
  http://localhost:8000/api/logout              # → 200 {message:"Logged out."}
```

## Frontend checks

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx vitest run --coverage   # src/lib/** ≥90%
```

## Manual validation scenarios (constitution manual gate)

Map to spec Success Criteria / acceptance scenarios:

1. **Register happy path (SC-001, US1)**: open `/register`, submit valid name/email/
   password+confirm → lands logged in; NavMenu shows Account + Logout.
2. **Register validation (SC-002, US1)**: duplicate email, weak password, mismatched
   confirm each show an inline field error; no account created.
3. **Login + logout (SC-003/SC-004, US2)**: valid creds → logged in; wrong creds → one
   generic error (no email/password disclosure); Logout → anonymous, `/account` now
   redirects to `/login`.
4. **Account page (US3)**: while logged in, `/account` shows your name + email; refresh
   keeps you logged in (FR-013).
5. **Redirect rules (SC-005, US4)**: anonymous `/account` → `/login`; authenticated
   `/login` or `/register` → `/`; refresh each restores correctly from the URL.
6. **Accessibility (SC-008, US5)**: every input has a label; tab order is logical; errors
   announced via `aria-describedby`/`aria-invalid` and shown as text (not color alone).
7. **Responsive + theme (SC-007, US5)**: forms reflow with no horizontal scroll at
   ~320px / tablet / desktop; appearance follows OS light/dark.
8. **Security (SC-009)**: inspect every response — no `password`/hash field ever appears.

## Done When
- All four endpoints behave per [contracts/auth-api.md](./contracts/auth-api.md).
- Backend + frontend lint clean; both stacks ≥90% coverage.
- All manual scenarios above pass.
