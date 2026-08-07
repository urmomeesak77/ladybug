# Quickstart: Validating Password Recovery and Change

**Feature**: 022-password-recovery | **Branch**: `022-password-recovery`

How to run and prove this feature end to end. Design details live in
[`plan.md`](./plan.md), [`research.md`](./research.md), [`data-model.md`](./data-model.md) and
[`contracts/`](./contracts/); this file is the run guide.

---

## 0. Prerequisites

- Docker Desktop running. **There is no local PHP** — every backend command goes through a
  container (project convention).
- `LADYBUG_DATA_ROOT` resolves (default `C:\docker_permanent`).
- **No migration ships with this feature.** `password_reset_tokens` and `sessions` come from the
  initial migration. Still confirm the dev database is not lagging before manual QA — a merged
  migration can sit unrun against dev MySQL for a long time undetected:

```powershell
docker compose exec backend php artisan migrate:status
```

- Dev mail goes to the log (`MAIL_MAILER=log`), so "the inbox" is
  `backend/storage/logs/laravel.log`.

---

## 1. Start the stack

```powershell
docker compose up -d
```

SPA on `http://localhost:5173`, API behind nginx on `http://localhost:8000`.

Two reminders that bite in this repo:

```powershell
# PHP edits need a restart — opcache runs with validate_timestamps=0 in dev
docker compose restart backend

# After a merge or checkout, Vite can keep serving the pre-merge UI
docker compose restart frontend
```

---

## 2. Automated gates

Run these before calling anything done — they are the gates CI runs.

```powershell
# Backend: lint, tests, coverage
docker compose exec backend vendor/bin/pint --test
docker compose exec backend php artisan test
docker compose exec backend php artisan test --coverage-clover=coverage.xml
python .github/scripts/check_coverage.py coverage.xml     # >= 90%

# Frontend: lint, tests, coverage (the gate spans ALL of src/)
cd frontend
npm run lint
npm test
npm run test:coverage
```

New tests, mirroring their sources (Principle VII):

| Source | Test |
|---|---|
| `app/Services/PasswordService.php` | `tests/Unit/Services/PasswordServiceTest.php` |
| `app/Support/PasswordPolicy.php` | `tests/Unit/Support/PasswordPolicyTest.php` |
| `app/Support/SessionRevoker.php` | `tests/Unit/Support/SessionRevokerTest.php` |
| `app/Http/Controllers/PasswordResetController.php` | `tests/Feature/Http/Controllers/PasswordResetControllerTest.php` |
| `AuthController::updatePassword` | added to `tests/Feature/Http/Controllers/AuthControllerTest.php` |
| `src/lib/passwordApi.ts`, `passwordModel.ts` | `tests/lib/passwordApi.test.ts`, `passwordModel.test.ts` |
| `src/pages/{ForgotPassword,ResetPassword}Page.tsx` | `tests/pages/…` |
| `src/components/AccountPasswordForm.tsx` | `tests/components/AccountPasswordForm.test.tsx` |

Tests run only against sqlite `:memory:` — `Tests\TestCase` hard-aborts otherwise. Keep `DB_*` out
of compose and CI.

Two assertions carry requirements that prose cannot enforce and that must exist as tests:

- **SC-003 / FR-004 — paired non-enumeration.** Post a well-formed address in **five** states —
  real and enabled, unknown, disabled, inside the 60-second resend interval, and with the mailer
  forced to throw (FR-032, which must also reach `report()`) — **four paired attempts each, 20 in
  all**, and assert every response is identical in status, body and headers. Exclude the
  `X-RateLimit-*` headers (they count the caller's own traffic, not the address) and raise the
  cap for the test, or the 20 attempts trip the 5/min limiter and you end up asserting the
  throttle instead of the feature. **Timing is not compared** — FR-004 excludes it and research
  D12 says why.
- **SC-007 / FR-017 / FR-020 — field-by-field.** Snapshot every `users` column before a change by
  each route and assert only `password` and `remember_token` differ.

---

## 3. Scenario 1 — recover access (US1 + US2, P1)

1. Open `http://localhost:5173/login`. **A "Forgot password?" control is visible** (FR-001).
2. Follow it → `/forgot-password`. It is a real, shareable address: refresh it, and open it in a
   fresh tab while signed out (FR-002, FR-025).
3. Submit a registered address. The confirmation appears (FR-004).
4. Pull the link out of the "inbox":

```powershell
Select-String -Path backend\storage\logs\laravel.log -Pattern 'reset-password' | Select-Object -Last 1
```

   Check its shape against [`contracts/recovery-link.md`](./contracts/recovery-link.md): the path
   segment is a 40-char sha1, **not** an e-mail address, and the token is after a `#`.
5. Open the link. The form asks for a new password twice, asks for **no** current password, and
   **prints no e-mail, name, or other account detail anywhere** (FR-011).
6. Set `NewPassw0rd`. You land on the confirmation with a link to `/login`, and **you are not
   signed in** (FR-021) — confirm the left menu still shows the signed-out state.
7. Sign in with the new password: it works. Sign in with the old one: refused exactly as any wrong
   password is (US2 scenario 5).

**Expected total: 4 steps and under 3 minutes (SC-001, SC-002).**

---

## 4. Scenario 2 — the address nobody uses (FR-004, SC-003)

Submit `nobody-here@example.com` at `/forgot-password`. **The confirmation is word-for-word the
one from step 3**, and `laravel.log` gains no new message. Repeat with a disabled account (disable
one at `/admin/users` first): same confirmation, still no message (FR-006).

---

## 5. Scenario 3 — dead, spent, and tampered links (US4, SC-004)

Each of these must show *"This password recovery link is no longer valid."* with a control back to
`/forgot-password`, and change no password:

| Case | How to produce it |
|---|---|
| **Already used** | Re-open the link from step 3 after completing it |
| **Superseded** | Request two links in a row; open the older one |
| **Tampered token** | Change one character after the `#` |
| **Tampered digest** | Change one character in the path segment |
| **No token at all** | Open `/reset-password/<digest>` with no fragment |
| **Expired** | `docker compose exec backend php artisan tinker` → `DB::table('password_reset_tokens')->update(['created_at' => now()->subMinutes(61)]);` then open the link |
| **Account deleted** | Delete the account at `/admin/users`, then open its link |
| **Voided by an account-page change** | Request a link, then change the password at `/account`; open the link (FR-008) |

**And the one that must NOT die**: open a fresh link, submit `short` (fails the policy), see the
inline message — then submit a valid password. **It still works** (US2 scenarios 3–4, FR-013).

Also confirm merely opening does not consume: open a fresh link, close the tab without submitting,
open it again — still live (FR-012).

---

## 6. Scenario 4 — change the password while signed in (US3, SC-009, SC-010)

1. Sign in, open `/account`. A labelled password section sits beside the display-name section
   (FR-026).
2. Wrong current password → that field is flagged inline, nothing changes, and **neither new-password
   field is repopulated** (US3 scenario 3).
3. Correct current password + a valid new one → "Password updated.", and **you are still signed in
   on this client** (FR-028). Under 60 seconds, no inbox involved (SC-009).
4. Sign out and back in with the new password.

**Google-only account** (FR-031): sign in with Google on an account that has never had a password
(`has_password: false`). The section shows **no current-password field** and states in text that
you sign in with Google. Set a password; afterwards sign in **both** ways — the Google link still
works (FR-019), and "Sign-in method" now reads "Google and email/password".

---

## 7. Scenario 5 — a change ends every other session (US5, SC-005)

1. Sign in as the same account in **two** browsers (or one plus a private window). Confirm both.
2. Tick "Remember me" in one of them (018).
3. From a third client, change the password — once via a recovery link, once from `/account`.
4. In each of the first two, trigger any request (navigate, or reload `/account`). Both are
   **signed out** (FR-016). The remembered one does not silently come back (US5 scenario 2).
5. In the account-page trial, the **third** client — the one that made the change — is still
   signed in (FR-028).
6. Sign in fresh: role and verification state are unchanged (FR-017, FR-020, US5 scenario 3).

Cross-check the mechanism directly:

```powershell
docker compose exec backend php artisan tinker
>>> DB::table('sessions')->where('user_id', <id>)->count();   # 0, or 1 for the acting client
>>> DB::table('password_reset_tokens')->count();              # 0 for that address
```

---

## 8. Rate limits (FR-010, FR-030, FR-033)

With the dev default of 5/min:

- Submit `/forgot-password` six times inside a minute → the sixth is refused, and the refusal
  names no account.
- Submit a wrong current password six times at `/account` → the sixth is refused (SC-010). The cap
  is per **account** here, per **requester** on the anonymous routes (research D7).
- Confirm the buckets are separate: after tripping the reset limit, **logging in still works** —
  `throttle:password` and `throttle:auth` do not share a bucket.

---

## 9. Presentation gates (SC-008, Principles III/IV/VIII)

For `/forgot-password`, `/reset-password/:hash`, and the `/account` section:

- **Light and dark** — flip the OS preference; both follow it.
- **320px → wide desktop** — no horizontal scrolling, no clipping, no overlap.
- **Back / Forward / Refresh** — every state restores correctly. Specifically: refresh the reset
  page with a live link and confirm **it still works** (the fragment is deliberately not stripped,
  research D3).
- **No password value is ever repopulated** after a submission (FR-024).
- **Keyboard and screen reader** — every input reaches its label; every error is announced as text
  (FR-023).

---

## 10. Indexing (FR-018)

```powershell
curl http://localhost:8000/robots.txt          # must Disallow /forgot-password and /reset-password
curl -s http://localhost:8000/forgot-password | Select-String noindex
curl -s http://localhost:8000/reset-password/0000000000000000000000000000000000000000 | Select-String noindex
```

Both must answer **200** (they are real addresses, FR-025) and both must carry `noindex`. If
either 404s, the `SpaRoutes.php` half of the mirror was missed.

Also confirm the token never reaches a server: with a link open, check nginx's access log and
`laravel.log` for the token string — **it must appear in neither**, because a fragment is never
transmitted (research D2).

---

## 11. End-to-end suite

```powershell
.\scripts\e2e.ps1
```

Adds `frontend/tests/e2e/password-recovery.spec.ts`, which drives the full journey against the
isolated stack and reads the link out of `laravel.log` via `MailLog.latestResetLink` — the same
helper shape `verify-email.spec.ts` already uses. It covers: request → link → new password → old
password refused → new password signs in → the link is dead on re-open.

---

## 12. Operations note (not wired up)

Expired token rows are not swept (research D10). Laravel ships `php artisan auth:clear-resets` for
that; run it manually if the table is ever worth tidying. It is deliberately **not** added to a
scheduler, because this project runs none, and an expired row is already refused.
