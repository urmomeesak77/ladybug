# Code Review — 022-password-recovery

**Range:** `b0dde73..b9f9e4f` (70 files, ~4,800 lines of code + ~2,400 of specs)
**Date:** 2026-08-11
**Method:** three parallel reviewers (backend/security, frontend, tests/traceability); every
Critical finding re-verified against the source by the coordinating session.
**Verdict:** merge with fixes — items 1–3 before shipping.

> **Status: all findings addressed** (same day, follow-up pass). Each item below carries a
> **Resolved** line naming what changed. Verified afterwards: backend `OK (1097 tests, 3038
> assertions)`, Pint `PASS (202 files)`, frontend `1164 passed (104 files)` at 98.26% line
> coverage, `tsc --noEmit` and `eslint` clean. The previously flaky snapshot test was run 5×
> in a row green.

---

## Summary

The security core is well built. Non-enumeration is enforced *structurally* rather than by
convention — `PasswordService::sendRecoveryLink` returns `void`, so the controller has no status
to branch on and an existence oracle cannot be reintroduced by a later edit. The 422/403 split
correctly keeps a live link alive after a rejected password, because `ResetPasswordRequest`
judges the password before the broker ever sees the token. The fragment-borne token never enters
a URL, a server log, or `document.title`, and no path in the SPA strips or leaks it.

The test suite is unusually strong: `PasswordResetControllerTest.php:71` compares 20 *real*
response structs across five account states rather than merely asserting each is a 200, and the
dead-link matrix covers ten construction paths against both endpoints.

Three findings block: a deployment-config omission that makes the feature's headline security
control inert in production, a spec-vs-code disagreement whose test flakes ~40%, and one line of
missing branch logic that can push a user into destroying their own live link.

---

## 1. CRITICAL — the headline security control does nothing in production

**File:** `deploy/backend.env.example:34`

`SESSION_DRIVER=file`. Dev, e2e and phpunit were all moved to `database` in this range
(`backend/.env.example:57`, `backend/.env.e2e.example:36`, `backend/phpunit.xml:45`); the
production template was missed.

`SessionRevoker::revoke()` is a `DELETE FROM sessions WHERE user_id = ?`. Under the file driver
that table is permanently empty, so the delete is a no-op. And because 018's remember-me is a
presence cookie plus session lifetime rather than Laravel's recaller, rotating `remember_token`
invalidates nothing either.

**Failure scenario:** an attacker signs in on device Y with a stolen password. The victim
completes recovery from the emailed link, or changes the password on `/account`. The server
answers 200 and all four "side effects on success" in `contracts/password-recovery-api.md` are
claimed. Device Y keeps working for its full lifetime, including the 7-day remembered one.
US5 / FR-016 / SC-005 is entirely inert exactly where it matters.

`tasks.md:44` identified this premise verbatim ("*every* environment overrides it to `file`")
and it was resolved for dev/e2e/test but not for `deploy/`.

**Second-order consequence.** `backend/config/session.php:126` now sets `'lottery' => [0, 100]`
globally, which was the *file* handler's only GC trigger, and
`SessionGarbageCollector::sweep()` only touches the DB table. Production's
`storage/framework/sessions` now grows without bound where it previously swept at 2%/request.

**Fix:** set `SESSION_DRIVER=database` in `deploy/backend.env.example`; update the comment in
`deploy/php/entrypoint.sh:11` and the section at `docs/DEPLOYMENT.md:379`; note in the runbook
that the cutover signs every current user out once (file sessions are not migrated).

---

## 2. HIGH — FR-034's "leaves no trace" is false, and its test flakes ~40%

**Files:** `backend/tests/Feature/Http/Controllers/AuthControllerTest.php:871`,
`backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php:361`
(helper at `AuthControllerTest.php:927`)

Found independently by two reviewers.

`userSnapshot()` reads `SELECT *` from the live schema and unsets only `password` and
`remember_token`. But `PasswordService::applyNewPassword` (`PasswordService.php:169`) calls
`$user->save()`, and `users` carries `$table->timestamps()` — so `updated_at` moves on every
password change. The assertion passes only when the whole request happens to execute inside one
wall-clock second (helped by `BCRYPT_ROUNDS=4`).

Reproduced — five runs of `--filter byte_identical`: FAIL, OK, FAIL, FAIL, OK.

```
- 'updated_at' => '2026-08-11 12:42:50',
+ 'updated_at' => '2026-08-11 12:42:51',
/app/tests/Feature/Http/Controllers/AuthControllerTest.php:881
```

**Why it matters beyond the flake.** FR-034 says a change leaves no "password last changed"
record and SC-007 says no field other than the password and its dependent sessions differs.
`users.updated_at` is precisely a per-account timestamp that moves on exactly this event. The
test is not merely flaky — it asserts an invariant the code does not hold.

**Fix — decide it explicitly.** Either:

- set `$user->timestamps = false` around the credential save so FR-034's claim becomes true; or
- accept `updated_at`, unset it in `userSnapshot()` with a WHY comment recording that it is a
  generic Eloquent timestamp and *not* an FR-034 record, and amend FR-034 in the spec.

**Do not** fix this with `freezeTime()` alone. That was one reviewer's suggestion; it would
restore a green suite over a spec the code does not meet, and the schema-driven snapshot — which
is otherwise the single best assertion in this feature — would go on quietly lying.

---

## 3. HIGH — a rate-limited link check reports a live link as dead, then advises the action that destroys it

**File:** `frontend/src/pages/ResetPasswordPage.tsx:49`

```ts
PasswordApi.checkToken(hash, token).then((result) => setView(result.ok ? 'form' : 'dead'));
```

`CheckTokenResult` deliberately separates `invalid` / `rate-limited` / `network`
(`passwordApi.ts:18-22`), and `PasswordModel.resetFailureMessage` has a sentence for each. This
line discards the distinction. `contracts/frontend.md` §3 says `dead` is entered on **403 or a
missing/malformed fragment**, not on any non-OK result.

The *submit* path at `:88-94` gets this right, with a comment stating the exact principle line 49
breaks — "a spent rate limit or a lost connection leaves the link as good as it was, so the form
stays where it is."

**Failure scenario.** The `password` limiter is 5 requests/minute keyed by IP, shared across
`/password/forgot`, `/password/reset/check` and `/password/reset`. A user on an office or CGNAT
IP clicks "Send recovery link" three times, opens the emailed link, and the check 429s. The page
says *"This password recovery link is no longer valid"* and offers *"Request a new link"* — which,
if it succeeds, supersedes and destroys the link they are actually holding (FR-008). Because
`checkedFor` blocks a retry for the life of the mount, there is no in-page recovery short of a
reload. A 419 CSRF mismatch or a transient fetch failure lands in `network` and therefore in
`dead` the same way.

**Fix:** branch on the kind — `ok → 'form'`, `kind === 'invalid' → 'dead'`, anything else stays in
`checking` (or a new `unavailable` state) rendering `PasswordModel.resetFailureMessage(result.kind)`
with a retry affordance. Reset `checkedFor.current = ''` on a non-`invalid` failure so retry is
possible. No test covers this path today — `tests/pages/ResetPasswordPage.test.tsx` exercises only
`checkToken` ok/403.

---

## Important

### 4. `/api/health` silently gained a database dependency

`backend/bootstrap/app.php:45` prepends `CollectStaleSessions` to the whole `api` group, and it
calls `SessionGarbageCollector::sweepIfLucky()` — a DB delete — on the lottery share of *every*
api request. `backend/routes/api.php:17-18` documents health as "Intentionally has no database
dependency so it answers before any migrations exist," and `deploy/deploy.sh:49`,
`deploy/restore.sh:65` and `.github/workflows/ci.yml:166` all use it as the readiness probe.

On a first deploy against a fresh server, roughly 1 in 50 probes now 500s instead of answering,
and `docker-compose.e2e.yml:47`'s stated guarantee becomes probabilistic. The retry loop papers
over it, which is why it will be confusing when it bites.

**Fix:** skip the sweep for the health path, or drive it from a scheduled command rather than a
globally-prepended middleware.

### 5. The session-GC bugfix's wiring is untested — the bug can silently return

`backend/bootstrap/app.php:45-46`, `backend/config/session.php:126`

Commit `3e1b3c2` fixes remember-me sessions being deleted early, but its tests cover only the
mechanism: `SessionGarbageCollectorTest` calls `sweep()` directly, and
`CollectStaleSessionsTest.php:25` registers its own throwaway probe route, with a docblock
stating it tests the middleware independently of the surrounding pipeline.

Nothing asserts that `CollectStaleSessions` is prepended to the `api`/`web` groups, or that
`config('session.lottery')` is `[0, 100]`. Revert either one-liner and the whole 7-day
remember-me logout bug returns with a fully green suite.

### 6. FR-018's at-rest half is untested

`backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php:187`

FR-018 requires the token be stored so a database read alone does not yield a usable link. The
suite asserts the *plaintext* token's shape (`/^[0-9a-f]{64}$/`) but never that the stored
`password_reset_tokens.token` differs from it. Store the token verbatim and every test still
passes, because they all supply the plaintext anyway. Two lines where the row is already loaded:

```php
$this->assertNotSame($token, $before->token);
$this->assertTrue(Hash::check($token, $before->token));
```

### 7. The account page dead-ends Google-only users

`frontend/src/components/AccountPasswordForm.tsx:71,135`

`PasswordModel.validateChange` is called with no `touched` set, so it judges every field on every
keystroke — but its `FieldErrors` are only *counted*, never rendered. `PasswordField` (`:32-56`)
has no `error` prop and no `onBlur`; the only per-field visual is `aria-invalid`, which has no CSS
rule anywhere in `theme.css`.

A Google-only user opens `/account`, types `hunter2` twice, and "Save password" stays greyed out
forever. Nothing states the 8-char / mixed-case / digit rule, and the server 422 that would state
it is unreachable because the client blocks the submit. Because the button is `disabled` rather
than `aria-disabled` it is also unfocusable. This is FR-031's "second way in" flow, and FR-013
requires the policy be validated client-side *for feedback*.

**Fix:** give `PasswordField` an `error?: string` + `onBlur`, drive it from a real `touched` set,
and render through `AuthField`'s existing `role="alert"` + `aria-describedby` markup. Reusing
`useAuthForm` here would remove the divergence from `/login`, `/register` and `ResetPasswordPage`
entirely.

### 8. Live regions are mounted already-populated, so they will not be announced

`frontend/src/pages/ForgotPasswordPage.tsx:22`, `ResetPasswordPage.tsx:19,26,100`

FR-023 requires every outcome be conveyed in text *and announced to assistive technology*. An
ARIA live region must exist in the accessibility tree before its content changes; a node that
arrives already carrying its own `role="status"` is not reliably announced.
`VerifyEmailPage.tsx:113` already does it right — one permanently-mounted `<p role="status">`
whose text swaps.

A screen-reader user submits their address on `/forgot-password`: the form disappears, focus
falls to `<body>` because the button they activated was unmounted, and the confirmation is
silently swapped in. They hear nothing.

**Fix:** render one always-present status paragraph whose text content changes. Consider also
moving focus to the outcome (`tabIndex={-1}` + `ref.focus()`), since the activated control is
destroyed on submit in both pages.

### 9. TOCTOU on FR-008's lever

`backend/app/Services/PasswordService.php:96`

`reset()` resolves the user with no row lock, and the broker's `exists()` is a plain `SELECT` +
`Hash::check` before the write. An account-page `change()` deletes the outstanding token, but a
link reset already past its `exists()` check can land after it — so FR-008's advertised lever
("an owner who suspects their inbox is compromised shuts an attacker's outstanding link by
changing their password here") has a window where the attacker's reset wins.

**Fix:** `lockForUpdate()` on the users row in `recoverableAccount`, or re-verify `exists()`
inside the transaction.

### 10. Two config reads that fail silently or fatally

- `backend/config/auth.php:104-105` — `env('AUTH_PASSWORD_RESET_EXPIRE', 60)` is not cast. A
  present-but-empty `AUTH_PASSWORD_RESET_EXPIRE=` yields `''` → 0 minutes → every recovery link
  dead on arrival, with no error anywhere. Use `max(1, (int) env(...))`, as `remember.lifetime`
  already does.
- `backend/app/Support/SessionGarbageCollector.php:33` — `[$chance, $outOf] =
  config('remember.gc_lottery')` has no fallback. A missing key makes `random_int(1, 0)` throw a
  `ValueError` from globally-prepended middleware: a hard 500 on every request. The prod
  entrypoint re-runs `config:cache` so the window is narrow, but a one-line default closes it.

---

## Minor

- **Mangled digests miss the shared refusal.** `SpaRoutes::RESET_PASSWORD_HASH` is a strict
  `[0-9a-f]{40}`, so a link damaged by an email client (trailing `.`, `)`, a wrapped line) hits
  the SPA 404 instead of the 403 "no longer valid" page with its "request a new one" control.
  FR-015 / US4 scenario 3 wants one refusal with a path back for every altered link.
- **The refreshed user is dead weight.** `passwordApi.ts:152` maps a `UserResource` that
  `AccountPasswordForm.tsx:97` ignores, doing `await refresh()` — a second `GET /api/user` —
  instead. `contracts/account-password-api.md` explicitly justifies the response body as avoiding
  that round trip. Either consume `result.user` or drop the mapping.
- **Error text renders under the wrong field.** `AccountPasswordForm.tsx:133` places the message
  below the third field regardless of which field it concerns; `aria-describedby` is correct, so
  only sighted users are affected. Related: `fieldFor` (`:26`) falls back to `'password'` for any
  422 naming neither field.
- **`fieldFor` is a loose standalone helper** (`AccountPasswordForm.tsx:22`).
  `docs/CODING_CONVENTIONS.md` puts logic helpers on a class; it belongs on `PasswordModel`
  beside `changeFailureMessage`. (Precedent exists — `VerifyEmailPage.statusTextFor` — so this is
  consistency-level.)
- **FR-026's password section has no accessible name.** `<form className="account__password">`
  has no heading, no `aria-label`, and its `<fieldset>` no `<legend>`.
- **Neither new page sets `document.title`**, unlike `HomePage` / `PostPage` / `ModerationPage` /
  `UserAdminPage`. Not a token leak — the fragment never reaches the title — just inconsistent.
- **No SPA route-registration test** for `/forgot-password` or `/reset-password/:hash`. Both are
  deliberately unguarded (research D11: a signed-in visitor must be able to open someone else's
  link); wrapping either in `RequireAnon` would silently break that with a green suite.
- **No e2e for US3** (the account-page change), including FR-028's "the acting client stays
  signed in" — the one outcome unit tests can only approximate via cookie replay.
- **`MailLog.latestResetLink` is a no-retry `readFileSync`** (`password-recovery.spec.ts:55`).
  The ordering reasoning is sound and it matches `verify-email.spec.ts`, so it is not a new risk,
  but `expect.poll(...)` would remove the last unguarded timing assumption in a spec that has
  already needed two timing fixes.
- **Rate-limit keying is proved only via `actingAs()`** (`AuthControllerTest.php:739,750`), which
  installs the user resolver directly. The real cookie path is fine — Laravel's
  `$middlewarePriority` orders `AuthenticatesRequests` ahead of `ThrottleRequests` — but the
  FR-030 per-account claim currently rests on a test that cannot detect its own failure mode.
  Compare the recorded Sanctum guard-switch pitfall.
- **Style.** `checkResetToken` uses `Password::getRepository()` while its siblings use
  `Password::broker()->…`; `PasswordPolicy` is not `final` where `SessionRevoker` and
  `SessionGarbageCollector` are. `ResetPasswordPage` (~74 lines) and `AccountPasswordForm`
  (~78 lines) exceed the 50-line JS budget, though `LoginPage` (77) already sets that precedent
  for JSX-heavy components.

---

## What was verified green

- `OK (87 tests, 269 assertions)` across the eight backend 022 test classes.
- `npx tsc --noEmit` and `npm run lint` clean in `frontend/`.
- `backend/phpunit.xml`'s `SESSION_DRIVER` `array`→`database` change *strengthens* the gate
  (session rows become real). Frontend coverage config (`include: src/**`, `lines: 90`) is
  untouched. No coverage threshold, exclusion, or gate was weakened anywhere in the range.
- Principle VII path mirroring is correct for all 15 new/changed test files.
- The `theme.css` h1 unification did not regress `PostPage` — `.post-item .feed-item__title`
  (specificity 0,2,0) still beats the new bare `h1` (0,0,1). `.moderation h1`, `.user-admin h1`
  and `NotFoundPage`'s h1 do shrink, consistent with the commit's stated intent.

---

## Resolution log

All findings addressed in a follow-up pass on 2026-08-11. Numbering matches the sections above.

| # | Finding | Resolution |
|---|---|---|
| 1 | Prod `SESSION_DRIVER=file` | `deploy/backend.env.example` set to `database` under a comment recording why it must stay so; `deploy/php/entrypoint.sh` no longer claims sessions live on disk; `docs/DEPLOYMENT.md` §5 gained the requirement plus a **cutover note** (signs everyone out once, no migration needed). |
| 2 | FR-034 false + flaky snapshot | Fixed at the source, not the test: `applyNewPassword` suppresses Eloquent timestamps around the credential save, so `updated_at` genuinely does not move. Both `userSnapshot()` helpers keep comparing it, with a comment saying why. **5 consecutive green runs** where ~40% failed before. |
| 3 | Rate-limited check reported as dead | New `unavailable` view state: renders the matching failure sentence and a **"Try again"** button, never the dead wording or "Request a new link". Retry participates in the once-per-mount guard's key, so it actually re-asks. 5 new tests. |
| 4 | `/api/health` gained a DB dependency | `CollectStaleSessions` skips an `UNSWEPT_PATHS` list; test pins it. |
| 5 | GC fix wiring untested | Three tests: sweep through a **real** `api`-group route, probe never sweeps, `session.lottery` stays `[0, 100]`. |
| 6 | FR-018 at-rest untested | `assertNotSame` + `Hash::check` added where the row was already loaded. |
| 7 | Account page dead-ends Google-only users | `PasswordField` gained `error` + `onBlur`; component keeps a `touched` set and renders per-field messages with `role="alert"` and per-field `aria-describedby`. 6 new tests. |
| 8 | Live regions inserted already-populated | Both pages keep one `<p role="status">` for the page's life and swap only its text. Each test asserts the region is the **same node** before and after. |
| 9 | TOCTOU on FR-008's lever | `reset()` opens its transaction first and resolves the account with `lockForUpdate` inside it; `change()` takes the same row lock. The paths now serialise. |
| 10 | Config reads failing silently/fatally | `auth.php` casts with `max(1, …)` (`throttle` with `max(0, …)` — 0 is meaningful there); `SessionGarbageCollector::lottery()` falls back to `[2, 100]` and floors the denominator, with a data-provider test. |

Minor items, all applied:

- **Mangled digests** — `SpaRoutes::EMAIL_DIGEST_PATTERN` widened to `[^/]+` so a damaged link
  reaches the shared refusal instead of a 404. `contracts/frontend.md` §1 rewritten to explain
  the looseness; the old strict-pattern test became two tests (damaged links reach the page; a
  missing handle still 404s).
- **Unused refreshed user** — `useAuth` gained `adopt(user)`; `AccountPasswordForm` consumes
  `result.user` instead of a second `GET /api/user`, which is what the endpoint's `UserResource`
  was for. Test asserts `adopt` is called and `refresh` is not.
- **Error under the wrong field** — fixed as part of #7; messages render inside their own field.
- **`fieldFor` loose helper** — moved to `PasswordModel.changeFailureField` with its own tests.
- **FR-026 unnamed section** — `<h2 id="account-password-heading">Password</h2>` plus
  `aria-labelledby` on the form, with a `.account__section-title` rule.
- **No `document.title`** — both pages set "Reset password" on mount.
- **No SPA route-registration test** — four `App.test.tsx` cases, two of which assert a
  **signed-in** visitor still reaches each route (the research-D11 property nothing enforced).
- **No US3 e2e** — new spec covering the account-page change, FR-028's "stays signed in", and
  that only the new password works afterwards.
- **`MailLog` no-retry read** — wrapped in `expect.poll`, removing the spec's last unguarded
  timing assumption.
- **Rate-limit keying proved only via `actingAs`** — new test drives the limiter over a **real
  session cookie**, two accounts on one IP. Writing it surfaced a latent helper bug:
  `loginSession` called `forgetGuards()` but not `shouldUse('web')`, so a second login in one
  test hit `RequestGuard::attempt`. Fixed, hard-coded to `'web'` because `shouldUse()` overwrites
  `auth.defaults.guard` and reading it back restores nothing.
- **Style** — `Password::broker()->getRepository()` for consistency; `PasswordPolicy` made
  `final`. Function-length items left alone (page components, existing `LoginPage` precedent).

### Deliberately not done

- **Focus management** on the outcome (`tabIndex={-1}` + `ref.focus()`), suggested alongside #8.
  The persistent live region fixes the announcement, which was the finding; moving focus is a
  broader UX change that should be decided for all the auth forms at once, not just these two.
- **Function-length refactors** for `ResetPasswordPage` / `AccountPasswordForm`. Both are
  JSX-heavy page components, `LoginPage` (77 lines) already sets the precedent, and ESLint does
  not enforce it. Splitting them further would trade a real readability cost for a nominal count.

### Verification

Run after the last change, not before:

- Backend: `OK (1097 tests, 3038 assertions)`; Pint `PASS (202 files)`.
- Frontend: `104 files, 1164 passed`; coverage `Lines 98.26%` (gate 90%); `tsc --noEmit` and
  `eslint` both clean.
- The e2e specs were **not** run — they need the isolated `docker-compose.e2e.yml` stack
  (`scripts\e2e.ps1`). The two e2e changes (the `expect.poll` and the new US3 spec) are
  therefore unverified against a live browser.

### Noted, not fixed

`tsc --noEmit` does not cover `tests/` — several existing auth-context stubs typed as
`AuthContextValue` are missing `role` and still typecheck. That is why adding `adopt` to the
context surfaced as a runtime failure rather than a type error. Pre-existing and out of scope
here, but worth a look.
