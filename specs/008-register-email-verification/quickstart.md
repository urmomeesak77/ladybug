# Quickstart: Registration Email Verification

**Feature**: 008-register-email-verification

Validation guide for the implemented feature. Contracts:
[verification-api.md](./contracts/verification-api.md),
[frontend.md](./contracts/frontend.md); state machine:
[data-model.md](./data-model.md).

## Prerequisites

- Docker Desktop running; dev stack up from the repo root:

  ```powershell
  docker compose up -d
  ```

  Frontend: <http://localhost:5173> · API: <http://localhost:8000>.
- Backend `.env` has `MAIL_MAILER=log` and `FRONTEND_URL=http://localhost:5173`
  (mirrors `.env.example`). After changing backend `.env` or PHP files:
  `docker compose restart backend` (opcache holds timestamps).
- Dev mail lands in the log **inside the storage bind-mount**:
  `C:\docker_permanent\ladybug-storage\logs\laravel.log`.

## Scenario 1 — Register → verify (US1, P1)

1. Open <http://localhost:5173/register>, register a fresh address
   (e.g. `verify-me@example.test`).
2. **Expect**: you land on `http://localhost:5173/verify-email`, which names
   `verify-me@example.test` and offers a resend button.
3. Tail the mail log and copy the newest link:

   ```powershell
   Select-String -Path C:\docker_permanent\ladybug-storage\logs\laravel.log -Pattern 'verify-email' | Select-Object -Last 3
   ```

   (Join quoted-printable soft-wrapped lines and replace `=3D` with `=` if the
   URL is split.)
4. Open the link (`http://localhost:5173/verify-email/{hash}?expires=…&signature=…` —
   `{hash}` is a sha1 digest of your email; the link carries no user ids).
5. **Expect**: a confirmation page; `/account` now shows **Verified** with no
   resend button. Refresh the link URL: an "already verified" notice, no error
   (idempotence, FR-005).

## Scenario 2 — Tampered / expired links (FR-004)

- Alter one character of `signature` (or `hash`, or `expires`) in the link and
  open it. **Expect**: a "link invalid or expired" page offering resend; the
  account stays unverified (check `/account`).
- Expiry: set `verification.expire` low is unnecessary — the tampered case
  exercises the same 403 path; the 24 h expiry is asserted in the backend
  feature tests by time-travel.

## Scenario 3 — Resend + rate limit (US2)

1. As a signed-in **unverified** user, press the resend button on
   `/verify-email` or `/account`. **Expect**: "sent" confirmation; a new link
   in the log; the new link verifies.
2. Press resend 7+ times within a minute. **Expect**: a clear "try again in a
   minute" style message (429), and success again after the window passes
   (SC-005).

## Scenario 4 — Link while signed out (US1 scenario 4)

1. Copy a valid link, open it in a private window (signed out).
2. **Expect**: the verification completes right there — no login round-trip
   (amended 2026-07-08). The visitor stays signed out; a dead link offers a
   login link instead of the (session-only) resend button.

## Scenario 5 — Account page status (US3)

- Unverified user → `/account` shows "Not verified" **in text** plus resend.
- Verified user → shows "Verified", no resend control.

## Automated gates (must pass before done)

```powershell
# Backend lint + tests + coverage (no local PHP — run in the php:8.3-cli image; ≥90%)
docker run --rm -v ${PWD}\backend:/app -w /app php:8.3-cli vendor/bin/pint --test
docker run --rm -v ${PWD}\backend:/app -w /app php:8.3-cli php artisan test

# Frontend lint + unit tests + coverage (gate spans ALL of src/; ≥90%)
docker compose exec frontend npm run lint
docker compose exec frontend npm run test

# E2E (isolated stack on 5174/8001; includes verify-email.spec.ts)
scripts\e2e.ps1
```

(CI runs the same gates; `.github/scripts/check_coverage.py` enforces the
Clover ≥90% threshold. Coverage needs `pcov` — CI's PHP has it; plain
`php:8.3-cli` does not, so run coverage the way the CI workflow does if
checking locally.)

## Manual constitution gates

- **Navigation** (III): Back/Forward/Refresh on `/verify-email` and the link
  landing page restore the correct view; URLs are shareable.
- **Theme & a11y** (IV): both pages in light and dark; status readable without
  color; resend button labeled; outcome messages announced.
- **Responsive** (VIII): 320 px → desktop, no horizontal scroll, touch-sized
  buttons.
