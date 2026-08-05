# Quickstart — Validating "Remember Me"

**Feature**: `018-remember-me-login` | **Spec**: [spec.md](./spec.md)

Waiting 7 real days is impractical, so every scenario below shortens the window via
`REMEMBER_ME_LIFETIME` (D6) instead of `SESSION_LIFETIME`, so the non-remembered baseline (US3)
stays provably untouched while the remembered path is exercised on a human timescale.

## Prerequisites

- Stack running via `docker compose up` (per repo root `README`/`CLAUDE.md`).
- A test account (`php artisan tinker` or the existing seed data) with a known
  email/password.
- Browser devtools open to the Application/Storage → Cookies panel, to inspect
  `online-trash-session` and `online-trash-remember` directly.

## Scenario: US1 — stay signed in with Remember Me (P1)

1. `docker compose exec backend bash -c "echo REMEMBER_ME_LIFETIME=2 >> .env"` (2 minutes,
   for a fast loop), `docker compose restart backend`.
2. Log in at `/login` with "Remember me" checked. Confirm both cookies are present in devtools,
   each with a `Max-Age` around 120s.
3. Wait 60s (under the 2-minute window), then load any authenticated page (e.g. `/account`).
   **Expected**: still signed in, and both cookies' `Max-Age` have reset to ~120s again
   (renewed — confirms the sliding behavior, not just a static long cookie).
4. Restore `REMEMBER_ME_LIFETIME` in `.env` to its default (remove the line) and restart backend.

## Scenario: US2 — remembered session expires after inactivity (P2)

1. Repeat steps 1–2 above (short `REMEMBER_ME_LIFETIME`).
2. Do **not** touch the app for longer than the configured window (e.g. wait 150s for a 2-minute
   setting).
3. Load `/account`. **Expected**: redirected to `/login` — both cookies are gone or expired.
4. Separately, verify the *sliding restart* (spec Acceptance Scenario 2, US2): log in remembered,
   wait past half the window but return before it lapses, confirm you're still in, then wait the
   *original* full window again from that later visit — still signed in past what would have
   been the original expiry, because step 3 of D2 renewed the clock.
5. Restore `REMEMBER_ME_LIFETIME` to default afterward.

## Scenario: US3 — default (non-remembered) login is unaffected (P3)

1. With `REMEMBER_ME_LIFETIME` untouched (default 7 days) and `SESSION_LIFETIME` at its normal
   value, log in **without** checking "Remember me".
2. Confirm in devtools: only `online-trash-session` is set; `online-trash-remember` is absent.
3. Confirm the session cookie's `Max-Age` matches `SESSION_LIFETIME` (120 min) exactly as it did
   before this feature — no regression to the existing sign-in duration (SC-003).

## Edge cases to spot-check

- **Manual sign-out**: log in remembered, then click Log out. **Expected**: both cookies cleared
  immediately in the response (`Set-Cookie` with an expired date), regardless of how much of the
  remember window was left (FR-005).
- **Disabled account**: log in remembered as a user, have an admin disable that account (second
  browser/session), then make any request in the first session. **Expected**: `401`, both
  cookies cleared, next `/login` visit required (FR-006) — same as today's disabled-account
  behavior, now also covering the remember cookie.
- **Independence across devices**: log in remembered on device/browser A, log in **not**
  remembered on device/browser B with the same account. **Expected**: A keeps its long session,
  B keeps the normal 120-minute one — neither affects the other (Edge Case, FR-007).
- **Checkbox never pre-filled**: after any of the above, reload `/login`. **Expected**:
  "Remember me" is unchecked, regardless of the previous login's choice.

## Automated coverage (written during `/speckit-tasks` + `/speckit-implement`, not this guide)

- Backend (PHPUnit): `LoginRequest` accepts/defaults `remember`; `AuthController::login` queues
  the flag cookie and raises `session.lifetime` only when `remember` is true, and never on the
  disabled-account (403) or bad-credentials (401) paths; `logout` and `EnsureAccountEnabled`
  clear the flag cookie; the new early/late middleware pair, tested directly against a fake
  request/response cycle.
- Frontend (Vitest): `LoginPage` renders the checkbox unchecked by default, submits
  `remember: true/false` correctly, and the checkbox resets on remount; `AuthApi.login` passes
  `remember` straight through.
