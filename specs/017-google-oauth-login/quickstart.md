# Quickstart — validating Google sign-in

**Feature**: `017-google-oauth-login` | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/](./contracts/)

How to run and prove this feature. Implementation details belong in `tasks.md`; this file is the
validation guide.

---

## 1. Prerequisites

### 1.1 A Google OAuth client

Deployment prerequisite, not code (spec Assumptions). In the
[Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Create an **OAuth 2.0 Client ID**, type **Web application**.
2. Authorised redirect URIs — these must byte-match `GOOGLE_REDIRECT_URI`:
   - `http://localhost:8000/api/auth/google/callback` (dev — Google permits `http://localhost` on
     any port)
   - `https://online-trash.com/api/auth/google/callback` (production)
3. On the OAuth consent screen, request only `openid`, `email` and `profile` (FR-002).

### 1.2 Environment

`backend/.env` (dev) — the values are **secrets** and never committed (FR-023):

```
GOOGLE_CLIENT_ID=<from the console>
GOOGLE_CLIENT_SECRET=<from the console>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
```

`backend/.env.example`, `deploy/backend.env.example` and `backend/.env.e2e` carry the same three
keys with **empty** values.

`docker compose restart backend` after editing (the dev image runs opcache with
`validate_timestamps=0`).

### 1.3 Migrate

```powershell
docker compose exec backend php artisan migrate
```

Adds `user_identities` and makes `users.password` nullable
([data-model.md](./data-model.md) §1–§2).

---

## 2. Automated tests

There is no local PHP — the backend runs through the `php:8.3-cli` container (project convention).

```powershell
# Backend: full suite
docker compose exec backend php artisan test

# Backend: this feature only
docker compose exec backend php artisan test --filter='GoogleAuth|IdentityLink|UserIdentity|Jwt|OAuthFlowState'

# Backend: the coverage gate CI enforces (>=90%)
docker compose exec backend php artisan test --coverage-clover=coverage.xml
python .github/scripts/check_coverage.py backend/coverage.xml

# Frontend
cd frontend
npm run lint
npm run test -- --coverage

# Backend lint
docker compose exec backend vendor/bin/pint --test
```

**Expected**: everything green, coverage ≥90% on both stacks (SC-011). The features 007–015
suites must pass **unmodified** — see [contracts/password-login-invariant.md](./contracts/password-login-invariant.md) §3 (SC-007).

### 2.1 Test file map

| Source | Test |
|---|---|
| `app/Http/Controllers/GoogleAuthController.php` | `tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` |
| `app/Services/GoogleOAuthService.php` | `tests/Unit/Services/GoogleOAuthServiceTest.php` |
| `app/Services/IdentityLinkService.php` | `tests/Unit/Services/IdentityLinkServiceTest.php` |
| `app/Support/GoogleIdentity.php` | `tests/Unit/Support/GoogleIdentityTest.php` |
| `app/Support/OAuthFlowState.php` | `tests/Unit/Support/OAuthFlowStateTest.php` |
| `app/Utils/Jwt.php` | `tests/Unit/Utils/JwtTest.php` |
| `app/Models/UserIdentity.php` | `tests/Unit/Models/UserIdentityTest.php` |
| `app/Http/Resources/UserResource.php` | existing test + the two new fields |
| both migrations | `tests/Feature/Database/{SchemaTest,MigrationReversibilityTest}.php` |
| `src/lib/googleAuth.ts` | `tests/lib/googleAuth.test.ts` |
| `src/components/GoogleSignInButton.tsx` | `tests/components/GoogleSignInButton.test.tsx` |
| `src/pages/{Login,Register,Account}Page.tsx` | existing tests + the new cases |

Google is never contacted by the suite: `Http::fake()` intercepts the token endpoint and tests
synthesize the `id_token` as three base64url segments (research D16).

---

## 3. Scenario walkthrough — automated coverage

Each row is an acceptance scenario proved by a test, not by hand.

### US1 — create an account with Google

| Scenario | Assertion |
|---|---|
| AS1 | exactly one `users` row created from the claims; `Auth::check()` true |
| AS2 | `email_verified_at` set; the account passes the `verified` gate and can `POST /api/posts/{hash}/comments` |
| AS3 | `role = member`, `rating = 0`, `hash` matches `[A-Za-z0-9_-]{10}`, `disabled_at` null, `password` null |
| AS4 | `302` `Location` is `{FRONTEND_URL}{redirect}`, defaulting to `/`; and on the frontend, a `location.state.from` of `/posts/abc` reaches the start URL as `?redirect=%2Fposts%2Fabc` (`LoginPage.test.tsx`) — both halves, or the backend default silently swallows the intended path |

### US2 — sign in again

| Scenario | Assertion |
|---|---|
| AS1 | second flow with the same `sub` → same `users.id`; `User::count()` unchanged |
| AS2 | same `sub`, **different** `name` and `email` claims → still the same account; the stored email does **not** change (spec Assumptions) |
| AS3 | `POST /api/logout` ends it; `GET /api/user` → `{data: null}` |
| AS4 | `GET /api/user` after the redirect returns the account with no further provider call (`Http::assertSentCount(1)`) |

### US3 — address already belongs to an account

| Scenario | Assertion |
|---|---|
| AS1 | link attached to the existing account; `User::count()` unchanged; signed in as it |
| AS2 | `password` hash byte-identical afterwards, **and `POST /api/login` with the original password still returns `200`**; `role`, `rating`, posts, comments unchanged |
| AS3 | a third flow resolves via the link (assert by changing the claim email — it still lands on the same account) |
| AS4 | unverified existing account → linked **and** `email_verified_at` set |
| AS5 | `email_verified: false` → `?error=unverified_email`, `user_identities` empty |
| AS6 | existing account already linked to `sub` A, flow arrives with `sub` B on the same address → `?error=already_linked`; the original link's row is unchanged |

### US4 — the flow does not complete

| Scenario | Assertion |
|---|---|
| AS1 | `error=access_denied` → `?error=cancelled`, signed out, `User::count()` unchanged |
| AS2 | absent / altered / foreign `state` → `?error=state`, no session |
| AS3 | `expires_at` in the past → `?error=state`; **replaying a consumed state** → `?error=state` |
| AS4 | `Http::fake` returns `500` / throws → `?error=provider`; a separate test confirms `POST /api/login` still works |
| AS5 | two callbacks with the same code → at most one `users` row (the second fails the consumed-state check) |

### US5 — disabled and ineligible

| Scenario | Assertion |
|---|---|
| AS1 | disabled **linked** account → `?error=disabled`, no session, `disabled_at` unchanged |
| AS2 | a Google session hitting `GET /api/admin/users` as a member → `403`, exactly as a password session |
| AS3 | account hard-deleted mid-flow → new account created (the link cascaded); no error |
| AS4 | disabled **unlinked** account, address matches → `?error=disabled`, **`user_identities` still empty** and every `users` column unchanged (SC-006) |
| AS5 | re-enable that account, run the flow → links normally |

### US6 — presentation

Vitest for the components and pages; Playwright (`tests/e2e/google-signin.spec.ts`) for
presence, accessible name, keyboard reach, 320 px and desktop, light and dark. See
[contracts/ui-surface.md](./contracts/ui-surface.md) §6.

### Security invariants

| Assertion | Requirement |
|---|---|
| `?redirect=//evil.com`, `https://evil.com`, `/\evil.com` → destination is `{FRONTEND_URL}/` | FR-030, Principle VI |
| `id_token` with a foreign `aud` / wrong `iss` / past `exp` → `?error=provider` | FR-004 |
| `provider_user_id` in no response body of any endpoint this feature touches | FR-022, SC-009 |
| passwordless account cannot log in; its `401` is byte-identical to a wrong-password `401` | FR-020, SC-008 |
| rate limiter refuses past the `auth` cap and returns a redirect, never an HTML 429 | FR-008 |

---

## 4. Manual verification — the part tests cannot reach

The full round trip needs a real Google, which CI does not have (research D16, an acknowledged
gap). Run these against the dev stack with real credentials before calling the feature done.

Start: `docker compose up -d`, SPA at `http://localhost:5173`, API at `http://localhost:8000`.

### 4.1 Happy path (US1)

1. Sign out. Open `http://localhost:5173/login`.
2. Click **Continue with Google** → Google's consent screen appears.
3. Approve → you land back on the home feed, **signed in**.
4. `/account` shows your Google name, your address, `Verified`, and `Sign-in method: Google`.
5. Upload a meme and post a comment — **no verification email step** (FR-014).
6. `docker compose exec mysql mysql -uroot -proot trashdb -e "select id,name,email,password is null as no_pw,role,rating from users order by id desc limit 1;"`
   → `no_pw = 1`, `role = member`, `rating = 0`.
7. **Intended-path return (FR-006, US1 AS4)**: sign out, open a page behind `RequireAuth` (e.g.
   `/upload`) so the guard bounces you to `/login`, then click **Continue with Google**. You land
   back on `/upload`, not on the home feed — the `?redirect=` round trip works. Landing on `/`
   means the button was rendered without its `redirectTo` prop.

### 4.2 Return visit (US2)

Log out, click Continue with Google again → same account, same uploads, `select count(*) from users`
unchanged.

### 4.3 Collision (US3) — the security core

1. Register a password account with the address of a Google account you control; note the password.
2. Log out. Continue with Google using that address.
3. You are signed in as **that** account — same `hash`, same uploads.
4. `/account` now reads `Sign-in method: Google and email/password`.
5. Log out, and **log in with the original password** — it still works (SC-004).

### 4.4 Cancellation and disabled (US4, US5)

1. Start the flow, click **Cancel** at Google → back at `/login` with
   "Google sign-in was cancelled.", still signed out.
2. As a superuser, disable the Google-linked account at `/admin/users`.
3. Sign out and run the flow → "This account is disabled." — the **identical sentence** the
   password form shows.
4. `select * from user_identities` — unchanged. Re-enable, run the flow → in again.

### 4.5 Navigation (FR-030)

- Press **Back** at Google's consent screen → back on `/login`; the flow does not restart.
- **Refresh** `/login?error=cancelled` → same page, same message, nothing re-runs.
- After signing in, **Refresh** → still signed in, no trip to Google.
- **Back** from the post-sign-in page → does not re-enter the flow.

### 4.6 Theme, responsive, keyboard (US6, Principle IV + VIII)

- Toggle OS light/dark on `/login` and `/register` — the button follows.
- DevTools at **320 px**, tablet, wide desktop, both pages, both appearances: no horizontal
  scroll, no clipping, no overlap; the button is comfortably tappable.
- Reach the button by **Tab alone** and activate with **Enter**, then again with **Space**.
- A screen reader announces "Continue with Google, button" and reads the "or" separator.

---

## 5. E2E stack

```powershell
.\scripts\e2e.ps1
```

`backend/.env.e2e` carries the three `GOOGLE_*` keys with empty values, so the button renders and
the flow refuses with `?error=provider`. `tests/e2e/google-signin.spec.ts` asserts presence,
label, keyboard reach and reflow only — **the round trip is not e2e-tested**, by design.

---

## 6. Deployment

1. Register the production redirect URI (§1.1) **before** deploying — a mismatch is a
   `redirect_uri_mismatch` screen at Google, which no application code can catch.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `GOOGLE_REDIRECT_URI=https://online-trash.com/api/auth/google/callback` to
   `/web/online-trash.com/backend.env` on the server.
3. `deploy/deploy.sh` runs `php artisan migrate --force` as usual.
4. Verify with §4.1 against the live site.

**No nginx change is required.** `deploy/web/default.conf` already routes
`location ~ ^/(api|up|sanctum)(/|$)` to php-fpm, which is why the endpoints carry the `/api/`
prefix (research D2).

**Rolling back the nullable-password migration is a procedure, not a command.** Once Google-only
accounts exist, restoring `NOT NULL` errors under MySQL strict mode and silently writes `''`
without it. To roll back: export the affected accounts, decide their fate (delete, or set a
random hash and force a reset — noting password reset is unbuilt project-wide), then migrate.
`down()` is written for an empty schema, which is what `MigrationReversibilityTest` exercises
(research D6).

---

## 7. Definition of done

- [ ] Backend suite green; coverage ≥90% (`check_coverage.py` passes)
- [ ] Frontend `npm run lint` and `npm run test -- --coverage` green; coverage ≥90%
- [ ] `vendor/bin/pint --test` clean
- [ ] Playwright suite green, including `google-signin.spec.ts`
- [ ] Features 007–015 suites pass **unmodified** (SC-007)
- [ ] §4.1 – §4.6 walked by hand against a real Google client
- [ ] `.env.example`, `deploy/backend.env.example`, `.env.e2e` carry empty `GOOGLE_*` placeholders
      and **no real credential is in git** (FR-023)
- [ ] `docs/DEPLOYMENT.md` documents the Google client setup and the migration-rollback caveat
- [ ] `grep -r provider_user_id` finds it in no resource, no route, no frontend file (SC-009)
