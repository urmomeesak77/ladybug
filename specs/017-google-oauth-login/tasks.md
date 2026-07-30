# Tasks: Sign In / Sign Up with a Google Account

**Input**: Design documents from `/specs/017-google-oauth-login/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. SC-011 and Constitution Principle VII put this feature under the ≥90%
line-coverage gate on both stacks, and `quickstart.md` §2.1 names every mirrored suite. Test tasks
are therefore first-class and are written **before** the code they cover.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
shipped on its own. Phase order follows plan.md → "Recommended build order", which puts **US5
before US4** deliberately (US5 AS4 is a rule *about* the US3 path, so it lands while that code is
fresh; US4 is mostly tests over a controller shape that already exists).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`…`[US6]` — the spec user story this task serves
- Every task names its exact file path

## Path Conventions

Web application, decoupled two-app layout (plan.md → Project Structure):

- Backend: `backend/app/`, `backend/config/`, `backend/routes/`, `backend/database/`, tests
  mirrored under `backend/tests/`
- Frontend: `frontend/src/`, tests mirrored under `frontend/tests/`
- Deployment: `deploy/`, `docs/DEPLOYMENT.md`

**Toolchain note**: there is no local PHP. Every backend command runs through Docker
(`docker compose exec backend …`), and any PHP edit needs `docker compose restart backend` before
it takes effect (dev opcache runs `validate_timestamps=0`). Backend tests run on sqlite
`:memory:` only — `Tests\TestCase` hard-aborts otherwise.

**Standing constraint for every task below**: no existing assertion in the features 007–015 suites
may be edited to accommodate this feature (SC-007, `contracts/password-login-invariant.md` §3).
Adding new cases to an existing test file is fine; changing an existing one means the feature is
wrong, not the test.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The configuration block and the env placeholders every later phase reads. No
behaviour changes; nothing is user-visible.

- [X] T001 Add the `google` block to `backend/config/services.php` per research D14: `client_id` (`env('GOOGLE_CLIENT_ID')`), `client_secret` (`env('GOOGLE_CLIENT_SECRET')`), `redirect_uri` (`env('GOOGLE_REDIRECT_URI')`), `authorize_url` (`env('GOOGLE_AUTHORIZE_URL', 'https://accounts.google.com/o/oauth2/v2/auth')`), `token_url` (`env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token')`)
- [X] T002 [P] Add `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=` and `GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback` (client id/secret **empty**) to `backend/.env.example` — FR-023, no real credential is ever committed
- [X] T003 [P] Add the same three keys with **empty** values to `deploy/backend.env.example`, with `GOOGLE_REDIRECT_URI=https://online-trash.com/api/auth/google/callback`
- [X] T004 [P] Add the same three keys with **empty** values to `backend/.env.e2e` so the e2e stack boots, the button renders, and the flow refuses with `?error=provider` (quickstart §5). **Correction found during implementation**: `backend/.env.e2e` is gitignored (`backend/.gitignore:5`) and is generated from the tracked `backend/.env.e2e.example` by both `scripts/e2e.ps1` and `.github/workflows/ci.yml`, so the keys must land in the **template** as well or CI's e2e stack never sees them. Both files carry the three keys, all values empty (the redirect URI included — the e2e round trip is never driven)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema, the link model, and the four pure classes the flow is assembled from —
plus the FR-020 guards, which land **with** the nullable column and never after it. Nothing is
user-visible at the end of this phase, but every rule below is unit-testable in isolation.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Schema

- [X] T005 [P] Extend `backend/tests/Feature/Database/SchemaTest.php` (do not rewrite it) with the new-table assertions from data-model.md §1: `user_identities` exists with columns `id, user_id, provider, provider_user_id, created_at, updated_at`; `UNIQUE (provider, provider_user_id)` and `UNIQUE (user_id, provider)` both present; the `user_id` FK cascades on delete; and `users.password` is nullable
- [X] T006 Create `backend/database/migrations/2026_07_29_000000_create_user_identities_table.php` per data-model.md §1 — `foreignId('user_id')->constrained()->cascadeOnDelete()` (FR-032), `string('provider', 32)`, `string('provider_user_id', 255)`, `timestamps()`, the two unique indexes, and a `why` comment stating that `cascadeOnDelete` is deliberately the opposite of feature 013's `nullOnDelete` because an ownerless link would permanently refuse its own person a new account
- [X] T007 Create `backend/database/migrations/2026_07_29_000001_make_users_password_nullable.php` — `up()`: `$table->string('password')->nullable()->change()`; `down()`: `->nullable(false)->change()`, with a comment pointing at quickstart §6 (rolling back on a live database holding passwordless rows is a runbook procedure, not a command)
- [X] T008 Extend `backend/tests/Feature/Database/MigrationReversibilityTest.php` with both new migrations, asserting they reverse cleanly on an empty schema (research D6)

### The link model and its fixtures

- [X] T009 [P] Create `backend/tests/Unit/Models/UserIdentityTest.php`: `$fillable` is empty (a `fill()` of `provider_user_id` assigns nothing), `provider_user_id` is in `$hidden` and absent from `toArray()`, and `user()` resolves the owning `User`
- [X] T010 Create `backend/app/Models/UserIdentity.php` per data-model.md §1 — empty `$fillable` (with a `why` comment: `provider_user_id` is the sole key to an account, so mass assignment would be an account-takeover primitive), `$hidden = ['provider_user_id']`, `user(): BelongsTo`
- [X] T011 [P] Create `backend/database/factories/UserIdentityFactory.php` — `provider => 'google'`, a unique `provider_user_id`, `user_id` from `User::factory()`
- [X] T012 [P] Add a `googleOnly(): static` state to `backend/database/factories/UserFactory.php` — `password => null`, `email_verified_at => now()`, member role (data-model.md §9)
- [X] T013 Extend `backend/tests/Unit/Models/UserTest.php` with: `googleIdentity()` returns the `google` identity and ignores a row of any other provider; plus the `contracts/password-login-invariant.md` §5 assertions `Hash::check('', null) === false` and `Hash::check('', '') === false` (research D6 — framework behaviour a security requirement rests on must be asserted, not assumed)
- [X] T014 Add `googleIdentity(): HasOne` to `backend/app/Models/User.php`, constrained to `provider = 'google'`

### The pure classes (research D17)

- [X] T015 [P] Create `backend/tests/Unit/Utils/JwtTest.php`: base64url payload decode with and without padding; a malformed segment, a non-JSON payload and a token without three segments each fail; `iss` accepted for both `accounts.google.com` and `https://accounts.google.com` and rejected otherwise; `aud` mismatch rejected; `exp` in the past rejected with **no** leeway; the signature segment is never inspected (an arbitrary signature still passes)
- [X] T016 [P] Create `backend/app/Utils/Jwt.php` — `declare(strict_types=1)`, static methods, base64url payload decode via `base64_decode(strtr($segment, '-_', '+/'))` with padding restored, and hard `iss`/`aud`/`exp` checks. A `why` comment records research D5: the signature is deliberately not verified because the token arrives directly from the token endpoint over TLS authenticated with our client secret, and `App\Utils\Base64` is an integer→string hash encoder that cannot decode a JWT segment
- [X] T017 [P] Create `backend/tests/Unit/Support/GoogleIdentityTest.php` per data-model.md §5 and research D13: construction rejects an empty or >255-char `sub`, an address failing `FILTER_VALIDATE_EMAIL`, and an address >255 chars; `email_verified` is strictly boolean (`true`, `"true"`, `1` accepted; `"false"`, `0`, absent → false); `displayName()` strips `\p{C}` control characters, trims, caps at 255, falls back to the email local part, then to `Ladybug user`, and is never empty for any input
- [X] T018 [P] Create `backend/app/Support/GoogleIdentity.php` — a `readonly` value object with the four fields and `displayName(): string`, total by construction. A `why` comment records that the name is stored **raw** and escaped on output (React text children), the same treatment feature 015 gives comment bodies, because escaping at write time would double-escape legitimate names
- [X] T019 [P] Create `backend/tests/Unit/Support/OAuthFlowStateTest.php` (array session driver, no HTTP): `mint()` writes `oauth.google` with 64-hex `state`, a `code_verifier`, `expires_at = time() + 600` and the validated `redirect`; minting twice replaces the earlier flow; `consume()` reads **and removes** in one operation so a replay finds nothing; validation fails on absent, mismatched (`hash_equals`) and expired state; the `code_challenge` is unpadded base64url of `SHA-256(verifier)`; and the redirect guard maps `//evil.com`, `https://evil.com`, `/\evil.com`, a whitespace-smuggled value, a >512-char value and an absent value all to `/`, while keeping a plain `/posts/abc`
- [X] T020 [P] Create `backend/app/Support/OAuthFlowState.php` per data-model.md §4 — mint / validate / consume over the session store, `bin2hex(random_bytes(32))` state, the PKCE S256 verifier and challenge (research D4), and the `#^/(?![/\\])[^\s]*$#` + ≤512-char redirect guard applied **before** storage (research D10)
- [X] T021 [P] Create `backend/app/Exceptions/OAuthFailure.php` — a typed exception carrying exactly one of the seven D10 error codes (`cancelled`, `state`, `unverified_email`, `already_linked`, `disabled`, `rate_limited`, `provider`), so the controller's error path is one `catch` rather than a chain of `if`s

### The FR-020 guards (contracts/password-login-invariant.md)

- [X] T022 Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` with the §1 table: a `googleOnly()` account with any password → `401` whose body and headers are **byte-identical** to a wrong-password `401` on a normal account (SC-008); with `password: ""` → `422`; with the field absent → `422`; with `password: null` → `422`. Add cases only — edit nothing that is already there
- [X] T023 Confirm `backend/app/Http/Requests/LoginRequest.php` still marks `password` as `required` and leave it unchanged; add a `why` comment naming it as guard 1 of FR-020 (an absent or empty password is a `422` and never reaches `Auth::attempt()`)

**Checkpoint**: schema, model, fixtures, four pure classes and the password invariant are all in
place and green. `docker compose exec backend php artisan test` and `vendor/bin/pint --test` pass.

---

## Phase 3: User Story 1 - Create an account with Google (Priority: P1) 🎯 MVP

**Goal**: A visitor with no Ladybug account clicks **Continue with Google**, approves at Google,
and returns signed in to a brand-new, already-verified account with ordinary defaults.

**Independent Test**: with no matching account in the system, drive the flow end to end
(`Http::fake()` on the token endpoint) and confirm exactly one `users` row is created from the
claims, `Auth::check()` is true, `email_verified_at` is set, `role = member`, `rating = 0`, `hash`
matches `[A-Za-z0-9_-]{10}`, `password` is null, `disabled_at` is null, and the `302` lands on
`{FRONTEND_URL}{redirect}`.

### Tests for User Story 1

- [X] T024 [P] [US1] Create `backend/tests/Unit/Services/GoogleOAuthServiceTest.php`: the authorize URL carries `response_type=code`, `client_id`, `redirect_uri`, `scope=openid email profile`, `state`, `code_challenge`, `code_challenge_method=S256`, `access_type=online`, `prompt=select_account`; the token exchange posts `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`, `code_verifier` form-encoded with a 10 s timeout and **no retry**; only `id_token` is read from the response (`access_token` is never touched); a non-2xx response, a thrown connection error, and a response without `id_token` each raise `OAuthFailure('provider')`; a foreign `aud`, a wrong `iss` and a past `exp` each raise `OAuthFailure('provider')`; a missing `email` claim and `email_verified` not true each raise `OAuthFailure('unverified_email')`. Google is never contacted — `Http::fake()` only, with the `id_token` synthesized as three base64url segments (research D16)
- [X] T025 [P] [US1] Create `backend/tests/Unit/Services/IdentityLinkServiceTest.php` covering the **create** branch of research D8 step 6: no link and no account on this address → exactly one `users` row created from `displayName()` and the claim email, linked to the `sub`, `password` null, `email_verified_at` set via `markEmailAsVerified()`, `role = member`, `rating = 0`, a fresh `Str::createUniqueHash(10)`, `disabled_at` null. No HTTP anywhere in this file
- [X] T026 [US1] Create `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the US1 rows of quickstart §3: AS1 one account created and `Auth::check()`; AS2 the account passes the `verified` gate and can `POST /api/posts/{hash}/comments`; AS3 the ordinary defaults; AS4 the `302` `Location` is `{FRONTEND_URL}{redirect}`, defaulting to `/`. Plus the start-route behaviour from `contracts/google-auth-endpoints.md`: an already-authenticated request is a no-op `302 → {FRONTEND_URL}/` that writes **no** session state (FR-031), and `?redirect=//evil.com`, `?redirect=https://evil.com`, `?redirect=/\evil.com` all resolve to `{FRONTEND_URL}/`. Use the real session across both calls (`get('/api/auth/google/redirect')`, read the state, then `get('/api/auth/google/callback?...)`)

### Implementation for User Story 1

- [X] T027 [US1] Create `backend/app/Services/GoogleOAuthService.php` — authorize-URL building, the server-to-server code exchange (10 s timeout, no retry, form-encoded), and claims → `GoogleIdentity` via `Utils\Jwt`. **Touches no database** (research D17); a `why` comment says so, because that separation is what makes T024 HTTP-only and T025 database-only
- [X] T028 [US1] Create `backend/app/Services/IdentityLinkService.php` with research D8 steps 1, 2 and 6 only (FR-005 refusal before the transaction opens; `UserIdentity` lookup with `lockForUpdate`; create-and-link), the whole of steps 2–6 inside one `DB::transaction`. **Never talks to Google.** Leave steps 3–5 for US2/US3 — the method must already be shaped for them (a comment marks the insertion points)
- [X] T029 [US1] Create `backend/app/Http/Controllers/GoogleAuthController.php` with `redirect()` and `callback()` per `contracts/google-auth-endpoints.md`. Every exit is a `302`; failures are `{FRONTEND_URL}/login?error={code}` from one `catch (OAuthFailure)`. `redirect()` order is load-bearing: authenticated no-op → rate limit → unconfigured client → mint and redirect. Both actions check the limiter **in the controller** (`'google-oauth:' . $request->ip()` against `config('app.auth_throttle')`, `RateLimiter::hit()` only after the check passes) with a `why` comment naming research D11 — `throttle:` middleware would render Laravel's HTML 429, which FR-007 forbids. On success: `Auth::login()`, `session()->regenerate()`, then the redirect, in that order
- [X] T030 [US1] Register `GET /api/auth/google/redirect` (name `api.auth.google.redirect`) and `GET /api/auth/google/callback` (name `api.auth.google.callback`) in `backend/routes/web.php`, inside `Route::prefix('api')` and **above** the SPA shell catch-all, with a `why` comment naming the Sanctum mechanism from research D2: `EnsureFrontendRequestsAreStateful` starts a session only for requests whose `Origin`/`Referer` matches `SANCTUM_STATEFUL_DOMAINS`, and the callback arrives from `accounts.google.com`, so under the `api` group there would be no session to read the `state` back from
- [X] T031 [P] [US1] Create `frontend/tests/lib/googleAuth.test.ts`: `GoogleAuth.startUrl()` builds the start URL **on the `Api.base()` origin** — assert the full `http://localhost:8000/api/auth/google/redirect` shape, not a relative path (the SPA is served from `:5173` and the API from `:8000`, so a relative URL would navigate to the Vite dev server); it percent-encodes the `redirect` parameter; it omits the parameter when there is nothing to return to; and `GoogleAuth.errorMessage()` maps all seven codes to the sentences in `contracts/ui-surface.md` §2 with an unknown code and `undefined` both falling back to the `provider` sentence
- [X] T032 [US1] Create `frontend/src/lib/googleAuth.ts` — `class GoogleAuth` of static methods only (`startUrl`, `start`, `errorMessage`), per the conventions' "always prefer classes over standalone functions" rule. `startUrl()` composes on `Api.base()` (`frontend/src/lib/api.ts`), the single existing source of the API origin — never a relative path. `start()` is the only impure one (`window.location.assign`)
- [X] T033 [P] [US1] Create `frontend/tests/components/GoogleSignInButton.test.tsx`: the accessible name is exactly `Continue with Google`; Enter and Space both activate it; the icon is `aria-hidden`; after the first click it is disabled with `aria-busy="true"` and a second click does **not** navigate again (US4 AS5); and a `redirectTo` prop reaches `GoogleAuth.start()` while its absence starts the flow with no `redirect` parameter
- [X] T034 [US1] Create `frontend/src/components/GoogleSignInButton.tsx` — a real `<button type="button">` (not an anchor), an optional `redirectTo?: string` prop forwarded to `GoogleAuth.start()`, inline Google "G" SVG with `aria-hidden="true"` and no remote asset, local `pending` state set on click and never cleared (the page is navigating away), following `BusyButton`'s established pending pattern
- [X] T035 [US1] Extend `frontend/tests/pages/LoginPage.test.tsx` with cases asserting the Google button is present and reachable after the form controls in DOM order, **and that a router `location.state.from` of `/posts/abc` reaches the start URL as `?redirect=%2Fposts%2Fabc`** while a bare `/login` visit starts the flow with no `redirect` parameter (FR-006, US1 AS4). Add cases only
- [X] T036 [US1] Render `<GoogleSignInButton />` inside a new `.auth-alt` block below the form in `frontend/src/pages/LoginPage.tsx`, per the layout in `contracts/ui-surface.md` §2, with the visible `or` label, passing `redirectTo={(location.state as { from?: Location } | null)?.from?.pathname}` — the **same** `location.state.from` the password path already reads at `LoginPage.tsx` (research D10: a full-page navigation to Google destroys router state, so the intended path has to make the round trip as `?redirect=`, or FR-006 silently degrades to always landing on `/`). Markup and the prop only — the theming and responsive CSS land in US6

**Checkpoint**: the first point at which a person can sign in with Google. Backend suite, frontend
suite and both linters green.

---

## Phase 4: User Story 2 - Sign in again with Google (Priority: P1)

**Goal**: A returning visitor is recognised by Google's stable `sub`, not by their email address,
and lands in the same account with no second account created.

**Independent Test**: complete US1, log out, run the flow again with the same `sub` but a changed
`name` and `email` claim — the same `users.id` is signed in, `User::count()` is unchanged, and the
stored email did **not** change.

- [X] T037 [US2] Extend `backend/tests/Unit/Services/IdentityLinkServiceTest.php` with the **returning visitor** branch (D8 steps 2–3): an existing link for this `sub` resolves to its account and writes nothing at all; a changed `name`/`email` claim still resolves to the same account and does not rewrite the stored values; `markEmailAsVerified()` is **not** re-called when `email_verified_at` is already set (idempotence, data-model.md §3); the belt-and-braces `identity.user === null` branch falls through to creation rather than erroring (US5 AS3). **Correction found during implementation**: an ownerless link **cannot be constructed in this suite at all**. `Schema::disableForeignKeyConstraints()` compiles to `PRAGMA foreign_keys = OFF`, which SQLite silently ignores inside a transaction — and `RefreshDatabase` wraps every test in one — so deleting the owner *cascades the link away* instead of orphaning it. The branch is therefore proved two ways rather than one: T038 makes it total with no dead statement (see below), and the test asserts the branch's only reachable form, the real US5 AS3 path where the cascade has already removed the link and the visitor is simply new. "Writes nothing at all" is asserted by creating both rows two days in the past (`travel(-2)->days()`) and proving neither `updated_at` moved — a save on this path would drag one up to now; the same technique proves the verification stamp is not rewritten
- [X] T038 [US2] Add research D8 step 3 to `backend/app/Services/IdentityLinkService.php` — the link lookup returns its account and takes the returning-visitor path before the email is ever consulted, with a `why` comment naming FR-009/US3 AS3: once linked, recognition is by `sub`, so the email-collision path is never re-entered. **Implementation note**: the account is read as `$link?->user` and the return is guarded on the *result* being non-null, not on the link being found. That is one expression instead of a nested null branch, and it is what makes the method total without adding a statement that no test can reach: an ownerless link falls through to the paths below along the identical line the "no link at all" case already takes, so `IdentityLinkService.php` stays at **100% line coverage** (24/24) with no unreachable belt-and-braces to explain away
- [X] T039 [US2] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the US2 rows of quickstart §3: AS1 a second flow with the same `sub` → same `users.id`, count unchanged; AS2 same `sub` with different `name`/`email` → still the same account, stored email unchanged; AS3 `POST /api/logout` ends the session and `GET /api/user` returns `{data: null}`; AS4 `GET /api/user` after the redirect returns the account with no further provider call (`Http::assertSentCount(1)`). **Two corrections found during implementation**, both from driving a *second* flow over one session for the first time: (1) the sign-out helper must pass `Origin: http://localhost` **per request**, because `/api/logout` is on the `api` group where Sanctum starts a session only for a request whose Origin matches `SANCTUM_STATEFUL_DOMAINS` — without it `$request->session()->invalidate()` throws "Session store not set on request". This is the same research D2 mechanism that forced the two Google routes into `web.php`, now observed from the other side; every other request in the file stays deliberately origin-less because that is how a browser arrives back from `accounts.google.com`. (2) **A real fix to `GoogleAuthController`**: `Auth::login()` resolves whatever guard was last handed to `shouldUse()`, and the `auth:sanctum` middleware on the sign-out sets that to the token guard — which has no `login()` method at all (`BadMethodCallException: Method Illuminate\Auth\RequestGuard::login does not exist`). The callback now names its guard, `Auth::guard('web')->login($user)`, exactly as `AuthController::logout` already names it. Only the session guard owns a cookie session, so naming it is correct independently of the test that exposed it. AS2 drives the two different claim sets through one `Http::sequence()` rather than re-calling `Http::fake()`, which would reset the recorded-request log that AS4's `assertSentCount(1)` depends on

**Checkpoint**: US1 + US2 are the minimum shippable slice — an account you can both create and
return to.

---

## Phase 5: User Story 3 - Google address that already belongs to a Ladybug account (Priority: P1)

**Goal**: A Google-confirmed address that already belongs to a Ladybug account auto-links to that
**existing** account and signs the visitor in — one account, two doors, password untouched.

**Independent Test**: create a password account with a known address, run the flow with a Google
account bearing that address, and confirm the visitor is signed in as that account, the account
count is unchanged, the link is stored, and the original password still returns `200` at
`POST /api/login` afterwards.

**⚠️ Highest-risk story.** The auto-link is safe only while FR-005 (an unconfirmed address never
reaches the rule) and FR-012 (an already-linked account is refused) hold **together** — neither
may be relaxed independently.

- [X] T040 [US3] Extend `backend/tests/Unit/Services/IdentityLinkServiceTest.php` with the **collision** branch (D8 steps 4–5): an account holding the claim email gains the link and is returned; `email_verified_at` is set only if it was null (US3 AS4); `password`, `role`, `rating`, `disabled_at`, `disabled_by`, posts and comments are all byte-for-byte unchanged afterwards (FR-015, INV-6); an account already holding a `google` identity for a different `sub` raises `OAuthFailure('already_linked')` and leaves the original link's row untouched (US3 AS6); and an `email_verified: false` claim never reaches this branch at all (FR-005, US3 AS5)
- [X] T041 [US3] Extend `backend/tests/Unit/Services/IdentityLinkServiceTest.php` with the concurrency backstop from research D8: a `UniqueConstraintViolationException` on the insert triggers exactly **one** re-resolution, which then takes the returning-visitor path — at most one account, at most one session. **Correction found during implementation**: the race **cannot be staged for real in this suite** — there is one sqlite `:memory:` connection, so there is no second connection to commit a competing row from, and a competing row written on ours is rolled back with our own transaction. Both halves of the race are therefore played by listeners: a `UserIdentity::creating` listener throws the exception the driver would have thrown at exactly the statement it would have failed, and a `TransactionRolledBack` listener commits the winner's rows at the one moment our transaction is no longer holding them. Nothing about the service is stubbed — which account it returns and how many rows survive are entirely its own. Boundedness is proved separately by arming **two** failures and asserting the second propagates instead of looping
- [X] T042 [US3] Add research D8 steps 4–5 to `backend/app/Services/IdentityLinkService.php` — the email lookup with `lockForUpdate`, the `already_linked` refusal, the link insert and the conditional `markEmailAsVerified()` — plus the single-retry `UniqueConstraintViolationException` handler. A `why` comment records that the only writes on this path are the insert and the conditional verification stamp (FR-015). **Implementation note**: the retry re-runs the **whole transaction**, not the failed statement, so the half-built account of the losing attempt goes back with it; retrying inside the transaction would commit an orphaned `users` row. The file stays at **100% line coverage** (35/35)
- [X] T043 [US3] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the US3 rows of quickstart §3: AS1 link attached to the existing account, count unchanged, signed in as it; AS2 the password hash is byte-identical afterwards **and `POST /api/login` with the original password still returns `200`** (SC-004), with role, rating, posts and comments unchanged; AS3 a third flow resolves via the link even after the claim email changes; AS4 an unverified existing account is linked **and** verified; AS5 `email_verified: false` → `?error=unverified_email` with `user_identities` still empty; AS6 an account already linked to `sub` A meeting `sub` B on the same address → `?error=already_linked`, original link row unchanged. **Correction found during implementation**, from driving `POST /api/login` after a Google flow for the first time: the `signOut()` helper must also restore the ambient guard (`$this->app['auth']->shouldUse('web')`). `auth:sanctum` on the sign-out calls `shouldUse()`, which **overwrites `auth.defaults.guard` in the config**, so the unqualified `Auth::attempt()` in `AuthController::login` then resolves the token guard (`Method Illuminate\Auth\RequestGuard::attempt does not exist`). This is a test-process artifact and not a production defect — every real request boots its own container with the configured default — which is why the fix is in the helper and `AuthController` is left untouched (SC-007). It also means the restore must name `'web'` literally: reading `config('auth.defaults.guard')` back would just hand it the value the middleware already put there

**Checkpoint**: all three P1 stories are complete. The feature is functionally shippable.

---

## Phase 6: User Story 5 - A disabled or ineligible account cannot slip in through Google (Priority: P2)

**Goal**: A disabled account is refused at the Google door with the same outcome as at the password
door, and the refusal writes **nothing** — SC-006's "byte-for-byte unchanged" is a property of the
algorithm's ordering, not of a cleanup path.

**Independent Test**: disable a Google-linked account, run the flow, and confirm `?error=disabled`,
no session, `disabled_at` unchanged; then disable an *unlinked* account whose address matches and
confirm `user_identities` is still empty and every `users` column is untouched.

**Sequenced here, before US4**, because US5 AS4 is a rule *about* the US3 path just built.

- [X] T044 [US5] Extend `backend/tests/Unit/Services/IdentityLinkServiceTest.php` with both disabled checks: a disabled account reached **through its link** (D8 step 3) raises `OAuthFailure('disabled')` and writes nothing; a disabled account reached **by address** (D8 step 5) raises the same and leaves `user_identities` empty and every `users` column unchanged (US5 AS4, INV-9); re-enabling that account and re-running links normally (US5 AS5, FR-017 final clause). **Correction found during implementation**: written as first drafted, three of these tests **passed before the guard existed** and so proved nothing — "writes nothing" is trivially true on a path that was already returning the account without writing, and the re-enable test is trivially true when the first attempt links instead of refusing. All three now run through one `assertRefused()` helper that fails the test outright when no refusal is raised, so every one of the six is red without the guard and green with it. The column-level test additionally uses an **unverified** disabled account, because the conditional `markEmailAsVerified()` is the one write on the step-5 path that a guard placed too low would still let through — a verified fixture cannot tell the two placements apart
- [X] T045 [US5] Add the two disabled guards to `backend/app/Services/IdentityLinkService.php`, each placed **before** the first write on its path, with a `why` comment naming the 2026-07-29 clarification ("refuse first, write nothing") and SC-006 — a disabled account must not silently acquire a link on a sign-in it was always going to refuse. **Implementation note**: both call points share one `refuseIfDisabled()` rather than repeating the `if`, so the two D8 checks cannot drift apart; the `why` lives on the helper, which is the one place that reads both call sites at once. The file stays at **100% line coverage** (40/40 statements, 7/7 methods)
- [X] T046 [US5] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the US5 rows of quickstart §3: AS1 disabled **linked** account → `?error=disabled`, no session, `disabled_at` unchanged; AS2 a Google session hitting `GET /api/admin/users` as a member → `403`, exactly as a password session (FR-018); AS3 an account hard-deleted mid-flow → a new account is created with no error (the link cascaded, FR-032); AS4 disabled **unlinked** account matched by address → `?error=disabled` with `user_identities` empty and every `users` column unchanged; AS5 re-enable and re-run → links normally. **Notes**: (1) AS2's member→`403` half is already asserted by `test_the_established_session_is_an_ordinary_member` (T026), so rather than restate it this task adds the **other** half — an admin account reached through the Google door gets `200` on the same console. Together they prove the account's role decides in both directions and that the door confers nothing, which one-directional coverage cannot. (2) AS2 and AS3 were **green before the guard**, as the phase's own preamble predicts for outcomes the T029 controller shape already produces; only AS1, AS4 and AS5 were red first. (3) AS3 stages the delete **between** `startFlow()` and the callback rather than between two whole flows, so "hard-deleted mid-flow" is literal — the account disappears while the visitor is at Google's consent screen

**Checkpoint**: access revocation now covers both front doors.

---

## Phase 7: User Story 4 - The Google flow does not complete (Priority: P2)

**Goal**: Every cancelled, tampered, stale, replayed, rate-limited or provider-error return lands
on a real page with a plain-language message, signed out, with nothing written.

**Independent Test**: drive each failure and confirm the `302` `Location`, that the visitor is
signed out, and that `User::count()` and `UserIdentity::count()` are both unchanged. Zero blank
pages, zero raw errors, zero partial accounts (SC-005).

The controller shape from T029 already produces these outcomes; the work here is the tests, which
are the bulk of SC-005, plus whatever ordering gaps they expose.

- [X] T047 [US4] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with rows 2–5 of the callback outcome table: `error=access_denied` → `?error=cancelled`; any other Google `error` → `?error=provider`; absent, altered and foreign `state` → `?error=state`; an `expires_at` in the past → `?error=state`; **replaying a consumed state** → `?error=state`; a missing `code` → `?error=state`. Each asserts signed out and `User::count()` unchanged. **Correction found during implementation**: `?error=` with an **empty** value does **not** reach the provider branch. Laravel's *global* `ConvertEmptyStringsToNull` (confirmed by listing the default global stack, not assumed) turns it into an absent parameter before the controller sees it, so the request is judged on its state and code like any other. That is the right outcome — nothing went wrong at Google, so `provider` would be the wrong sentence — and the fix was to the test's expectation, not the controller. The row is now its own test naming the mechanism, in the same spirit as T013's `Hash::check` assertions (research D6: framework behaviour a refusal path rests on is asserted, not assumed). **Every test here was green the moment it was written**, as the phase preamble predicts, so each was mutation-checked by deleting the guard it claims to exercise and confirming it goes red — the provider-error branch, the state comparison, the TTL check, the `code` guard and `consume()`'s `pull`-not-`get`. Two of them (an absent `state`, and a callback with no flow at all) are refused by **two** independent guards, so no single-guard mutation reddens them; they go red only when both are removed. That is recorded in the file so a surviving single mutation is not later mistaken for a vacuous test. The staged expiry is written through with `session()->save()`: the next request reloads the session and `array_replace()` lets the **stored** value win, so an in-memory-only change is silently undone and the test would have passed for the wrong reason
- [X] T047a [US4] **Added during implementation** (same file, same phase): the `state` refusal is also proved for the two array-shaped-parameter cases that already existed, and a new group covers a well-formed token carrying **unusable claims** — no/empty/over-long `sub`, a malformed or over-long `email` → `?error=provider`, and an **absent** `email` → `?error=unverified_email`. The last row is the one worth having: `GoogleIdentity` is total by construction, so the distinction between "the provider misbehaved" and "you have no address at Google, use the password door" is a real branch, and asserting it *at the controller* is what pins FR-007/SC-005 — a constructor throwing anything but `OAuthFailure` would be a `500`, which is exactly the blank page the requirement forbids. Mutation-checked: removing the three constructor guards reddens all five `provider` rows and correctly leaves the `unverified_email` row green (it is guarded by `GoogleOAuthService`'s presence check instead)
- [X] T048 [US4] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the provider-failure rows: `Http::fake()` returning `500`, throwing a connection exception, and returning a body without `id_token` all → `?error=provider`; a separate case confirms `POST /api/login` still works while Google is down (FR-007 keeps the password path usable). The unreachable case uses `Http::failedConnection()` — a real rejected connection rather than a stubbed status, so it exercises the actual `ConnectionException` catch, and with no closure of our own. **A real test gap found during implementation**: as first written, the `400` and `500` rows **could not fail**. Deleting `->successful()` from `GoogleOAuthService::exchange` left the whole suite green, because an error response has no `id_token` in its body and the missing-token guard caught it instead — so nothing in the codebase pinned the status check at all. Closed by adding the one case that separates the two guards: a **`500` carrying a perfectly good `id_token`**. Without `->successful()` that signs the visitor in and redirects to `/` (watched it fail exactly so); with it, it is a `provider` refusal. Also extended past the task's letter with the FR-004 rows from quickstart §3's security-invariants table at controller level — a foreign `aud`, a wrong `iss`, a past `exp` and an **absent** `exp` each → `?error=provider` — since the signature is deliberately unverified (research D5) and those three claims therefore carry the entire weight. Mutation-checked: skipping `Jwt::verify` reddens all four; deleting the `id_token` guard reddens three of its four rows (an empty `id_token` is refused twice over, by the guard and by `Jwt`'s segment count, and is marked as kept for shape rather than coverage); neutering the connection catch reddens the unreachable row alone
- [X] T049 [US4] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with the rate-limiting cases (FR-008, research D11): both routes refuse past `config('app.auth_throttle')` with a `302 → /login?error=rate_limited` and **never** an HTML 429; the authenticated no-op on the start route does not consume the IP budget; a refused request does not deepen its own hole (`RateLimiter::hit()` runs only after the check passes). The cap is lowered to **2** per test rather than spending five requests reaching the real one, which also proves it is read from config (the e2e stack raises it for its own run). A fourth case asserts **both doors draw on one bucket** — two starts exhaust it and a callback is then refused — because a cap a flood can split across two routes is twice the cap. The limiter key is spelled out in the test rather than imported from the controller's private const, deliberately: a test that read the key from the code under test would still pass if the key drifted, and the two doors agreeing on one bucket is the whole assertion. **Two corrections found during implementation**, both test bugs: (1) the callback-flood case first staged its budget-spending requests with a **valid** state, so the first one attempted the token exchange and `Http::preventStrayRequests()` turned it into a `500`; it now spends the budget with a state nobody minted, which additionally proves the limiter is checked **before** the state is read — the same URL answers `state` twice and then `rate_limited`. (2) The no-op case asserted an empty bucket **after** the closing anonymous request, which spends a slot of its own, so it was asserting 1 and would have proved nothing; the assertion moved ahead of that request. Mutation-checked: moving `hit()` above the check reddens all three flood cases plus the deepen-the-hole case, and swapping the authenticated check below the limiter reddens the no-op case alone — the load-bearing ordering in each direction
- [X] T050 [US4] Extend `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` with US4 AS5: two callbacks carrying the same `code` create at most one `users` row and establish at most one session — the second fails the consumed-state check. Written as **two** cases, because the interesting question is not whether a failed callback can be repeated (T047 already covers that) but what a code that has *already bought an account and a session* buys on second presentation: (a) replayed over the **same** session → `?error=state`, still one `users` row, one link, the original session untouched, and `Http::assertSentCount(1)` — which is what proves the guarantee is **ours** rather than Google's, since the token endpoint is never asked twice and the test never leans on Google rejecting a re-used code; (b) replayed from a session holding **nothing** — the shape of the real attack, a callback URL lifted from a server log, a `Referer` header or a shoulder-surfed address bar → refused, nobody signed in, no second row. Case (b) is FR-003's "bound to the browser that started it" at controller level: the property a signed self-describing token would *not* have given us, since it would be unguessable and single-use yet redeemable from anywhere. The empty session is written through with `session()->save()` for the same reason T047's expiry is. Mutation-checked together: making `consume()` non-destructive **and** neutering `validate()` reddens both
- [X] T051 [US4] Reconcile `backend/app/Http/Controllers/GoogleAuthController.php` and `backend/app/Support/OAuthFlowState.php` with whatever T047–T050 expose, keeping the five distinct state failures collapsed into the single `state` code (research D10 — distinguishing them tells an attacker which half of the guard they beat) and every exit a `302`. **Outcome: no production change was needed, and that is a verified claim rather than an assumption.** The phase is `git diff --numstat` **503 insertions, 0 deletions, one file** — the feature's own test file — so SC-007 holds by construction as well. What T047–T050 exposed was one **test** gap (nothing pinned `GoogleOAuthService::exchange`'s `->successful()`, closed in T048) and two wrong expectations of mine, not an ordering gap in either named file. The `state` collapse was confirmed intact by driving all five distinct failures — absent, non-string, mismatched, expired and already-consumed — plus a missing and an empty `code`, and observing the identical `?error=state` from every one. "Every exit is a `302`" was verified rather than assumed by reading the whole refusal surface: `GoogleIdentity`'s constructor, `Jwt` and `GoogleOAuthService` throw **only** `OAuthFailure`, which the controller's single `catch` turns into a redirect, and the array-shaped-parameter cases cover the one shape that would otherwise be a `TypeError` under `strict_types`. All **seven** D10 error codes are now exercised end to end at the controller. Gates run and recorded: `vendor/bin/pint --test` PASS (168 files); `php artisan test` **927 passed, 2505 assertions**; the clover gate **98.90%** against a 90% floor, with every class this feature added at **100%** statements and methods — `GoogleAuthController` 39/39 (9/9 methods), `OAuthFlowState` 22/22 (5/5), `GoogleOAuthService` 44/44, `IdentityLinkService` 40/40, `GoogleIdentity` 19/19, `Jwt` 20/20, `OAuthFailure` 1/1

**Checkpoint**: the full failure taxonomy is proved. All seven error codes are exercised.

---

## Phase 8: User Story 6 - The Google option is visible, accessible, themed, and responsive (Priority: P3)

**Goal**: The control appears on both auth pages, separated from the password form by the **word**
"or", themed, keyboard-operable, and reflowing from 320 px to wide desktop; and the account page
states in words how the account signs in.

**Independent Test**: render both pages from ~320 px to wide desktop in light and dark with no
horizontal scroll, clipping or overlap; reach and activate the control by keyboard alone; confirm
its accessible name states the action; confirm the account page names the sign-in method in text.

**Last deliberately** — it is the only phase touching shared visible layout, so it carries the most
regression risk per unit of value.

### The account's sign-in method (FR-029)

- [ ] T052 [P] [US6] Extend `backend/tests/Unit/Http/Resources/UserResourceTest.php` with `has_password` (`password !== null`) and `google_linked_at` (the link's `created_at`, else `null`), and assert `provider_user_id` appears nowhere in the payload (FR-022, SC-009)
- [ ] T053 [US6] Add `has_password` and `google_linked_at` to `backend/app/Http/Resources/UserResource.php` (data-model.md §6), with a `why` comment noting the resource is only ever returned for the requester's own account
- [ ] T054 [P] [US6] Extend `frontend/tests/lib/authApi.test.ts` and `frontend/tests/lib/authModel.test.ts` with the mirrored `hasPassword` / `googleLinkedAt` fields and all four `AuthModel.signInMethod()` outcomes from `contracts/ui-surface.md` §3, including the unreachable total fallback
- [ ] T055 [US6] Add `hasPassword: boolean` and `googleLinkedAt: string | null` to the `AuthUser` type and its mapping in `frontend/src/lib/authApi.ts`, and `signInMethod(user)` to `frontend/src/lib/authModel.ts`
- [ ] T056 [US6] Extend `frontend/tests/pages/AccountPage.test.tsx` with all four sign-in-method strings, then append the `<dt>Sign-in method</dt><dd>{AuthModel.signInMethod(user)}</dd>` row to the existing `<dl class="account__details">` in `frontend/src/pages/AccountPage.tsx` — words, never an icon or colour (Principle IV)

### The register page and `?error=` rendering (FR-001, FR-007, FR-026)

- [ ] T057 [P] [US6] Extend `frontend/tests/pages/RegisterPage.test.tsx`: the Google button is present, the visible `or` label is in the DOM as text, and each `?error=` code renders its sentence into a `role="alert"` element (with `?error=<script>` and an unknown code both rendering the generic `provider` sentence and no markup). **Note**: unlike `LoginPage`, `RegisterPage` today has **no** form-level error region — only per-field `AuthField` errors — so T058 adds one; this task asserts the added element, not a pre-existing one
- [ ] T058 [US6] Add to `frontend/src/pages/RegisterPage.tsx`: the `.auth-alt` block with `<GoogleSignInButton redirectTo={…} />` and the visible `or` label; **a new form-level `<p className="auth-form__error" role="alert">` region** matching `LoginPage.tsx`'s conditional one byte for byte (`RegisterPage` has none today — `LoginPage` and `UploadPage` are the only two files carrying that element); and `?error=` rendering via `useSearchParams()` through `GoogleAuth.errorMessage()` into it. The register form's existing field-level behaviour is unchanged — this adds a sibling region, it does not touch `RegisterFields` or validation
- [ ] T059 [US6] Extend `frontend/tests/pages/LoginPage.test.tsx` with the same `?error=` cases, asserting the `disabled` code renders the **identical sentence** `LoginPage` already shows for a disabled password login (SC-006), then add the `?error=` rendering to `frontend/src/pages/LoginPage.tsx`

### Theme, layout and e2e (FR-028, SC-010, Principle VIII)

- [ ] T060 [US6] Add `.auth-alt`, `.auth-alt__label` and `.google-button` to `frontend/src/styles/theme.css` using the existing theme custom properties — both light and dark defined, nothing hard-coded, relative units, ≥44 × 44 CSS px touch target, full width at narrow widths. The Google mark's SVG keeps its official brand colours in both appearances, by design (`contracts/ui-surface.md` §4)
- [ ] T061 [US6] Create `frontend/tests/e2e/google-signin.spec.ts` — presence, accessible name, keyboard reach and activation, 320 px and desktop, light and dark, on **both** `/login` and `/register`. Plus the one FR-030 assertion that does not need a provider: load `/login?error=cancelled`, confirm the message renders, **reload**, and confirm the same page and message with no request to `/api/auth/google/*` (the `?error=` code is a display input, so a refresh re-runs nothing). Otherwise presence only: the round trip is deliberately not e2e-tested (research D16), which is possible because the button renders unconditionally (research D12)

**Checkpoint**: all six user stories complete. Both suites and both linters green.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: The documentation, the gates, and the manual walkthrough that no test can replace.

- [ ] T062 [P] Document the Google client setup in `docs/DEPLOYMENT.md`: creating the OAuth 2.0 Web-application client, the two authorised redirect URIs (they must **byte-match** `GOOGLE_REDIRECT_URI`), the `openid email profile` consent scopes, the three server env keys, and the migration-rollback caveat from research D6 (restoring `NOT NULL` once passwordless accounts exist is a procedure, not a command — quickstart §6)
- [ ] T063 [P] Run `grep -r provider_user_id` across `backend/app`, `backend/routes`, `frontend/src` and confirm it appears in no resource, no route, no log line and no frontend file (FR-022, SC-009)
- [ ] T064 Run the real CI gates and record the output: `docker compose exec backend vendor/bin/pint --test`; `docker compose exec backend php artisan test --coverage-clover=coverage.xml` then `python .github/scripts/check_coverage.py backend/coverage.xml`; `cd frontend && npm run lint && npm run test -- --coverage`. Both stacks ≥90% (SC-011). The clover file is written to `/app/coverage.xml` **inside** the container and read from `backend/coverage.xml` on the host — the same file, because `backend/` is bind-mounted; without that mount the second command needs an explicit `docker compose cp`
- [ ] T065 Confirm the features 007–015 suites pass **unmodified** — `git diff` shows no edited assertion in any pre-existing test file (SC-007, `contracts/password-login-invariant.md` §3)
- [ ] T066 Run `.\scripts\e2e.ps1` and confirm the Playwright suite, including `google-signin.spec.ts`, is green against the isolated stack with empty `GOOGLE_*` values
- [ ] T067 Walk quickstart.md §4.1 – §4.6 by hand against a real Google client on the dev stack — happy path, return visit, the US3 collision (including that the original password still works), cancellation and disabled, Back/Forward/Refresh at four points, and theme/responsive/keyboard. This is on the definition of done and is the only coverage the round trip has

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: needs Phase 1 (T001's config block is read by everything). **Blocks
  every user story**
- **US1 (Phase 3)**: needs Phase 2
- **US2 (Phase 4)**: needs US1 — it extends the same service method and the same controller test
- **US3 (Phase 5)**: needs US2 — D8 step 4 runs only when step 3 found nothing
- **US5 (Phase 6)**: needs US3 — US5 AS4 is a guard on the step-5 path US3 builds
- **US4 (Phase 7)**: needs US1 (the controller shape); independent of US3/US5, so it can run
  alongside them if staffed
- **US6 (Phase 8)**: needs US1 for the button and the `lib` class; the `UserResource` /
  `AccountPage` half (T052–T056) needs only Phase 2 and can start early
- **Polish (Phase 9)**: needs every story

### Within Each User Story

- Tests are written before the code they cover and must fail first
- Value objects before services, services before the controller, controller before the routes
- Backend before the frontend that calls it

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 are three different files — fully parallel
- **Phase 2**: the four pure classes are independent of each other and of the schema —
  T015+T016, T017+T018, T019+T020 and T021 are four parallel tracks. The schema track
  (T005→T008) and the model track (T009→T014) run alongside them
- **Phase 3**: the backend track (T024–T030) and the frontend track (T031–T036) touch no shared
  file and can run in parallel once T021 exists
- **Phase 7**: none. T047–T050 are independent *groups of cases*, but they all append to the one
  `GoogleAuthControllerTest.php` — see the serialization warning below, which wins
- **Phase 8**: T052–T056 (account page) and T057–T061 (auth pages) are independent
- **Phase 9**: T062 and T063 are parallel; T064–T067 are sequential gates

### Serialization warnings

- `backend/app/Services/IdentityLinkService.php` is touched by T028, T038, T042 and T045, and its
  test file by T025, T037, T040, T041 and T044 — these are **strictly sequential**, one story at a
  time. This is the single hottest file in the feature
- `backend/tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` is touched by T026, T039,
  T043, T046, T047, T048, T049 and T050 — append-only, one task at a time

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Four independent tracks, no shared file:
Task: "T015+T016 — JwtTest then Utils/Jwt.php"
Task: "T017+T018 — GoogleIdentityTest then Support/GoogleIdentity.php"
Task: "T019+T020 — OAuthFlowStateTest then Support/OAuthFlowState.php"
Task: "T021 — Exceptions/OAuthFailure.php"
```

## Parallel Example: Phase 3 (User Story 1)

```bash
# Backend and frontend tracks, disjoint files:
Task: "T024–T030 — GoogleOAuthService, IdentityLinkService, controller, routes"
Task: "T031–T034 — googleAuth.ts and GoogleSignInButton.tsx with their tests"
```

---

## Implementation Strategy

### MVP (Phases 1–4)

1. Phase 1 Setup → Phase 2 Foundational (blocks everything)
2. Phase 3 US1 — the first point at which anyone can sign in with Google
3. Phase 4 US2 — an account you can return to
4. **STOP and VALIDATE**: quickstart §4.1 and §4.2 by hand against a real Google client

### Incremental Delivery

1. Phases 1–2 → foundation, nothing user-visible, everything unit-tested
2. + Phase 3 (US1) → first Google sign-up
3. + Phase 4 (US2) → **minimum shippable slice**
4. + Phase 5 (US3) → the collision rule; the security core
5. + Phase 6 (US5) → disabled accounts refused at both doors
6. + Phase 7 (US4) → the full failure taxonomy proved
7. + Phase 8 (US6) → the presentation layer, both pages, the account row
8. + Phase 9 → docs, gates, manual walkthrough

### Do not ship without

- Phases 1–6 complete: shipping US1/US2 without US3 leaves a unique-constraint crash in the
  visitor's face, and without US5 leaves a disabled account a way in
- T064, T065 and T067 green — the coverage gates, the SC-007 regression proof, and the manual
  round trip CI cannot run

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- Every new source file has a mirrored test (quickstart §2.1); every test asserts real output
- The backend suite never contacts Google — `Http::fake()` only, with synthesized `id_token`
  segments
- PHP edits need `docker compose restart backend` before they take effect (dev opcache runs
  `validate_timestamps=0`)
- No new npm or Composer package at any point (Principle I). If a task appears to need one, that
  is a fresh dependency decision requiring written rationale and explicit approval **before**
  installation
- Commit after each phase; dispatch the `commit-quality-verifier` agent first and commit only on
  PASS
