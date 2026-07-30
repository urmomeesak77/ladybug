# Implementation Plan: Sign In / Sign Up with a Google Account

**Branch**: `017-google-oauth-login` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-google-oauth-login/spec.md`

## Summary

Ladybug has one front door: register → verify email → sign in with a password (feature 007/008).
This feature adds a second, equal one. A visitor clicks **Continue with Google**, approves at
Google, and comes back already signed in — no password chosen, no verification email waited on,
because Google has already confirmed the address.

The mechanism is the OAuth 2.0 authorization-code flow written **in house** against Google's
documented endpoints — two `GET` endpoints, one `POST` to Google's token endpoint, and no new
package (research D1 verifies `guzzlehttp/guzzle` is already a *production* dependency, so
Laravel's `Http` client ships in the deployed image).

Two schema changes: a `user_identities` table linking one account to one Google `sub`, and
`users.password` becoming nullable. Both directions of the one-to-one linking rule (FR-012) are
**unique indexes**, and FR-032's "the link dies with the account" is a `cascadeOnDelete` FK —
neither is application code that can be raced.

Three decisions carry the feature's risk, and all three are settled in Phase 0:

1. **The endpoints live in `routes/web.php` under an `/api/` prefix**, not in `routes/api.php`.
   Sanctum's `EnsureFrontendRequestsAreStateful` only starts a session for requests whose
   `Origin`/`Referer` matches `SANCTUM_STATEFUL_DOMAINS` — and the callback arrives from
   `accounts.google.com`. Under the `api` group there would be no session, so the `state` could
   not be read back and `Auth::login()` would write to a session nobody keeps. Silent in unit
   tests, broken in every real browser. (Research D2.)
2. **The ID token's signature is deliberately not verified**, because it arrives directly from
   the token endpoint over TLS authenticated with our client secret; `iss`, `aud` and `exp` are
   checked instead. This is what makes hand-rolling tractable without JWKS fetching and key
   rotation. (Research D5.)
3. **Every refusal precedes the first write.** A disabled account never acquires a link on a
   sign-in it was always going to refuse, so SC-006's "byte-for-byte unchanged" is a property of
   the algorithm's ordering, not of a cleanup path. (Research D8.)

The existing password path is untouched. No SPA route is added — the callback lands on `/login`,
so feature 016's hand-mirrored route table (`App\Support\SpaRoutes` ↔ `frontend/src/App.tsx`) does
not move.

## Technical Context

**Language/Version**: PHP 8.3 (Laravel 12, Sanctum 4) backend; TypeScript 5.x / React 18 + React
Router (Vite) frontend.

**Primary Dependencies**: **None added** (Principle I). The flow uses Laravel's `Http` client
(Guzzle — verified present in `composer.lock`'s production `packages`, research D1), `RateLimiter`,
the session store, Eloquent, and PHP's built-in `random_bytes` / `hash` / `base64_decode`. The
frontend adds no package: the Google mark is an inline SVG, not a script or a remote image.

**Storage**: MySQL 8.0 via Eloquent. One new table (`user_identities`) and one column change
(`users.password` → nullable). Flow state is **session-only** — no table, no pruning job.

**Testing**: PHPUnit (mirrored under `backend/tests/`, sqlite `:memory:` only — `Tests\TestCase`
hard-aborts otherwise); Vitest + Testing Library (mirrored under `frontend/tests/`); Playwright
e2e. `Http::fake()` intercepts Google's token endpoint, so the suite never leaves the machine.
≥90% line coverage gated in CI on both stacks.

**Target Platform**: Linux containers on a 1 vCPU / 960 MiB VPS. Production is a **single
canonical origin** (`https://online-trash.com`): edge nginx → `ladybug-web` (SPA + media) →
`ladybug-php`. Dev is two origins (SPA `:5173`, API `:8000`) — which the session cookie survives
unchanged, because `SameSite=Lax` permits top-level `GET` navigations and cookies ignore port
(research D15).

**Project Type**: Web application — decoupled Laravel API + React SPA.

**Performance Goals**: One added HTTP call per sign-in (the token exchange), 10 s timeout, no
retry. SC-001's "under 30 seconds from login page to signed in" is dominated by Google's own
consent screen; our two hops are a redirect and a single server-to-server `POST`.

**Constraints**:

- **Every exit from the callback is a `302` to a real SPA page** carrying one of a closed set of
  seven error codes. No JSON, no exception page, no blank screen (FR-007, SC-005). This is why
  rate limiting is checked in the controller rather than by `throttle:` middleware, which would
  render Laravel's HTML 429 (research D11).
- **Nothing arriving on the browser's query string is trusted** beyond `code` and `state`; every
  identity attribute comes from the token-endpoint response (FR-004).
- **`provider_user_id` is as internal as the database id** — no URL, no resource, no log
  (FR-022, SC-009).
- **No existing test may be edited to accommodate this feature.** The 007–015 suites are the
  SC-007 regression gate.
- The auto-link (FR-011) is safe only while **both** guards hold together: FR-005 (an unconfirmed
  address never reaches the rule) and FR-012 (an already-linked account is refused). Neither may
  be relaxed independently.

**Scale/Scope**: 6 user stories, 32 functional requirements. 8 new backend classes, 2 migrations,
1 model, 1 config block; 1 new frontend component + 1 lib class, 3 pages touched, 0 new routes.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Minimal Dependencies** | **PASS** | Zero new npm/Composer packages. `laravel/socialite`, `google/apiclient` and `firebase/php-jwt` were each evaluated and rejected in research D1/D5 — the last of these is the interesting one: it would only be needed for JWKS signature verification, which D5 shows is not required for a token received directly from the token endpoint. The premise the spec's assumption rested on ("the HTTP client the stack already ships") was **verified, not assumed**: `guzzlehttp/guzzle` is in `composer.lock`'s `packages`, not `packages-dev`, so it survives `composer install --no-dev` in `deploy/php/Dockerfile`. Column modification uses Laravel 11+'s native `->change()`, so no `doctrine/dbal` either. The Google "G" is an inline SVG — no third-party script and no remote asset enters the page. |
| **II. Coding Conventions** | **PASS** | PHP: `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, functions <30 lines — the eight-class split in research D17 exists to meet that cap, not for its own sake. TS: 2-space, semicolons, `PascalCase` components, `is`/`has` booleans (`hasPassword`, `isEmailVerified`). Every `lib/` addition is a class of statics (`GoogleAuth`), never loose exported functions. Closures are avoided per the standing preference: the resolution algorithm is an explicit sequence of guarded returns, not a chain of callbacks. Comments explain *why* (why the routes are not in `api.php`, why the disabled check precedes the write). |
| **III. Browser-Native Navigation** | **PASS** | No SPA route is added; `SpaRoutes` and `App.tsx` are untouched. The callback URL is consumed by a `302`, so it never becomes a returnable history entry — Back from `/login?error=…` lands where the visitor was, Refresh re-renders a plain page, and neither re-triggers the flow (FR-030). The `?error=` code is a display input only, rendered through a fixed map. Verification obligation: quickstart §4.5 walks Back/Forward/Refresh at four points in the flow. |
| **IV. Theme & Accessibility** | **PASS** | The button is a real `<button>` with a text accessible name ("Continue with Google"), keyboard-operable by construction, with an `aria-busy` pending state and an `aria-hidden` icon. FR-026's separation between the two sign-in methods is carried by a **visible text label ("or")**, not by a rule, a colour or a position — the contract states this explicitly because a styled `<hr>` alone would fail it. The account page names the sign-in method in **words**. Error messages land in the existing `role="alert"` region. Both appearances styled from the existing theme custom properties. |
| **V. Stable Meme Identifiers** | **PASS** | A Google-created account gets a fresh 10-char `[A-Za-z0-9-_]` `hash` from the same `Str::createUniqueHash(10)` the password path uses. No database id and no `provider_user_id` appears in any URL or response (FR-022, INV-8, SC-009), and the feature adds no addressable resource. |
| **VI. Security & Input Validation** | **PASS, with named obligations** | (a) **All provider input is validated and bounded before storage**: `sub` non-empty ≤255, `email` through `FILTER_VALIDATE_EMAIL` ≤255, `name` control-stripped and capped at 255, `email_verified` coerced strictly — only `true`, `"true"` or `1` yield true, everything else (including absence) is false (FR-024, D13, data-model §5). (b) **`iss`/`aud`/`exp` are hard-checked** on the ID token, and nothing from the browser query string is trusted beyond `code`/`state` (FR-004, D5). (c) **CSRF for the flow is the OAuth `state`**: 256 unguessable bits, browser-bound in the session, single-use via `pull()`, 10-minute TTL — plus PKCE S256 layered on top so an intercepted code is not redeemable (D3, D4). (d) **Open-redirect guard**: `?redirect=` must match `^/(?![/\\])[^\s]*$` and be ≤512 chars, validated server-side before storage; anything else becomes `/`. (e) **Rate-limited** at the same per-IP cap as `POST /api/login` (FR-008). (f) **Secrets in env only**, with empty placeholders in all three example files; `access_type=online` means Google never issues a refresh token, and the `access_token` is read by nothing — FR-021 has nothing to retain. (g) All queries through Eloquent; output escaped by React as text children, never `dangerouslySetInnerHTML`. (h) **`users.password` becoming nullable retires a `NOT NULL` invariant** — the compensating guards and their assertions are written down in `contracts/password-login-invariant.md`, including that the passwordless `401` must be **byte-identical** to the wrong-password `401` so the form is not an oracle (FR-020, SC-008). |
| **VII. Test Coverage & Organization** | **PASS** | ≥90% on both stacks (SC-011). Every new source file has a mirrored test, listed in `quickstart.md` §2.1. The design is testable by construction: `GoogleOAuthService` talks to Google and touches **no** database; `IdentityLinkService` touches the database and **never** talks to Google — so every FR-005/009/010/011/012/017 rule is unit-testable with no HTTP, and every provider behaviour with no database. `GoogleIdentity`, `OAuthFlowState` and `Utils\Jwt` are pure. Google is never contacted by the suite (`Http::fake()`). Edge cases enumerated per acceptance scenario in `quickstart.md` §3. |
| **VIII. Responsive Layout** | **PASS** | The button and its "or" separator use relative units inside the existing fluid auth-form layout; ≥44 px touch target, full width at narrow widths. Verified at 320 px / tablet / desktop in both appearances (quickstart §4.6, `google-signin.spec.ts`). |

**Technology & Architecture Constraints**: no stack deviation. Laravel + Sanctum, MySQL via
Eloquent + migrations, React 18 + React Router + Vite, all unchanged. Session handling, CORS,
Sanctum config and both nginx configs need **no edit** (research D15, D2) — the `/api/` prefix is
chosen precisely so the existing `location ~ ^/(api|up|sanctum)(/|$)` block already routes it.

**Post-Phase-1 re-evaluation**: re-run against the completed design (D1–D17, three contracts, the
data model). **No gate changed verdict.** Three things tightened during design rather than after:

- FR-012 moved from a service-level check to **two unique indexes** (D7), turning a race into a
  caught `UniqueConstraintViolationException` instead of a duplicate link.
- FR-008 moved from `throttle:` middleware to an in-controller check (D11), which is what makes
  "every exit is a redirect to a real page" structural rather than a review note.
- The FR-020 obligation grew its own contract file after D6 found that the guarantee now rests on
  `Hash::check()`'s null handling — framework behaviour that must be asserted, not assumed.

## Project Structure

### Documentation (this feature)

```text
specs/017-google-oauth-login/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 — decisions D1–D17
├── data-model.md                        # Phase 1 — schema, flow state, invariants INV-1..9
├── contracts/                           # Phase 1
│   ├── google-auth-endpoints.md         #   the two endpoints, outcomes, resolution
│   ├── password-login-invariant.md      #   what must stay true once password is nullable
│   └── ui-surface.md                    #   button, pages, messages, a11y, navigation
├── quickstart.md                        # Phase 1 — validation guide
└── tasks.md                             # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Exceptions/
│   │   └── OAuthFailure.php                  # NEW — typed failure carrying one error code
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── GoogleAuthController.php      # NEW — redirect() + callback(); every exit a 302
│   │   └── Resources/
│   │       └── UserResource.php              # + has_password, google_linked_at (own account only)
│   ├── Models/
│   │   ├── User.php                          # + googleIdentity(): HasOne
│   │   └── UserIdentity.php                  # NEW — empty $fillable, provider_user_id hidden
│   ├── Services/
│   │   ├── GoogleOAuthService.php            # NEW — authorize URL, code exchange, claims. NO DB
│   │   └── IdentityLinkService.php           # NEW — resolve/create/link in one txn. NO HTTP
│   ├── Support/
│   │   ├── GoogleIdentity.php                # NEW — readonly value object + displayName()
│   │   └── OAuthFlowState.php                # NEW — mint / validate / consume + PKCE
│   └── Utils/
│       └── Jwt.php                           # NEW — base64url payload + iss/aud/exp checks
├── config/services.php                       # + google block (5 env-driven keys)
├── database/
│   ├── factories/
│   │   ├── UserFactory.php                   # + googleOnly() state
│   │   └── UserIdentityFactory.php           # NEW
│   └── migrations/
│       ├── 2026_07_29_000000_create_user_identities_table.php    # NEW
│       └── 2026_07_29_000001_make_users_password_nullable.php    # NEW
├── routes/web.php                            # + the two /api/auth/google routes, ABOVE the shell
├── .env.example                              # + 3 empty GOOGLE_* placeholders
└── tests/
    ├── Feature/
    │   ├── Database/{SchemaTest,MigrationReversibilityTest}.php  # + new table, nullable column
    │   └── Http/Controllers/
    │       ├── GoogleAuthControllerTest.php  # NEW — the whole flow, Http::fake()
    │       └── AuthControllerTest.php        # + the passwordless-login cases
    └── Unit/
        ├── Http/Resources/UserResourceTest.php   # + has_password, google_linked_at
        ├── Models/{UserIdentityTest,UserTest}.php
        ├── Services/{GoogleOAuthServiceTest,IdentityLinkServiceTest}.php
        ├── Support/{GoogleIdentityTest,OAuthFlowStateTest}.php
        └── Utils/JwtTest.php

frontend/
├── src/
│   ├── components/GoogleSignInButton.tsx     # NEW — button, inline SVG, pending state
│   ├── lib/
│   │   ├── googleAuth.ts                     # NEW — class GoogleAuth (startUrl/start/errorMessage)
│   │   ├── authApi.ts                        # + hasPassword, googleLinkedAt on AuthUser
│   │   └── authModel.ts                      # + signInMethod(user)
│   ├── pages/
│   │   ├── LoginPage.tsx                     # + the alt block (redirectTo), + ?error= rendering
│   │   ├── RegisterPage.tsx                  # + the alt block, + a NEW role="alert" region, + ?error=
│   │   └── AccountPage.tsx                   # + the Sign-in method row
│   └── styles/theme.css                      # + .auth-alt, .google-button (both appearances)
└── tests/
    ├── components/GoogleSignInButton.test.tsx
    ├── lib/{googleAuth,authApi,authModel}.test.ts
    ├── pages/{LoginPage,RegisterPage,AccountPage}.test.tsx
    └── e2e/google-signin.spec.ts             # presence/a11y/reflow only — no round trip

deploy/backend.env.example                    # + 3 empty GOOGLE_* placeholders
backend/.env.e2e                              # + 3 empty GOOGLE_* placeholders
docs/DEPLOYMENT.md                            # + Google client setup, rollback caveat
```

**Structure Decision**: the existing decoupled two-app layout is kept exactly as-is. Every new
file lands in a directory that already exists and already holds its kind of thing —
`app/Exceptions/` is the only directory added, and it is a framework-standard one. The frontend
gains one component and one `lib/` class and no route. **Nothing in `deploy/` changes** beyond an
env placeholder: the `/api/` prefix was chosen so the existing nginx location block already routes
these endpoints (research D2).

### Recommended build order

Each step is independently verifiable; steps 1–4 together are the minimum shippable slice.

1. **Foundation** — the two migrations, `UserIdentity` + factory, `User::googleIdentity()`,
   `config/services.php`, the env placeholders, `Utils\Jwt`, `Support\GoogleIdentity`,
   `Support\OAuthFlowState`, `Exceptions\OAuthFailure`. Nothing is user-visible; all of it is
   unit-tested in isolation. Includes the `contracts/password-login-invariant.md` assertions —
   the nullable column lands with its guards, never before them.
2. **US1 + US2 (P1)** — `GoogleOAuthService`, `IdentityLinkService` steps 1–3 and 6, the
   controller, the routes, `GoogleAuth` + `GoogleSignInButton`, the button on `LoginPage`. First
   point at which anyone can sign in with Google. US2 falls out of the same code path.
3. **US3 (P1)** — `IdentityLinkService` steps 4–5: the email collision, the auto-link, the
   `already_linked` refusal, and the FR-015 "nothing else changed" assertions. Highest-risk story;
   built on top of a working flow so its tests are about the rule, not the plumbing.
4. **US5 (P2)** — the disabled checks at both resolution points, and the "writes nothing"
   assertions (SC-006). Small, and deliberately sequenced right after US3 because US5 AS4 is a
   rule *about* the US3 path.
5. **US4 (P2)** — the full failure taxonomy: cancellation, state failures, provider errors, rate
   limiting, double-submit. Mostly falls out of the controller's shape from step 2; the work is
   the tests, which are the bulk of SC-005.
6. **US6 (P3)** — the register page's button, the "or" separator, `?error=` rendering on both
   pages, the account page's sign-in-method row, theming, responsive CSS, and
   `google-signin.spec.ts`. Last because it is the only step that touches shared visible layout,
   so it carries the most regression risk per unit of value.
7. **Docs** — `docs/DEPLOYMENT.md`: the Google client setup, the redirect URIs, and the
   migration-rollback caveat from research D6.

## Complexity Tracking

**No Constitution violations.** Nothing here requires justification against a principle, so the
table stays empty.

Four choices will nonetheless draw a reviewer's eye. None is a violation; all four are recorded so
the answer is written down once rather than re-argued.

| Accepted choice | Why it is right | What keeps it safe |
|---|---|---|
| Auth endpoints in `routes/web.php` rather than `routes/api.php`, despite carrying an `/api/` path | Sanctum's `EnsureFrontendRequestsAreStateful` starts a session **only** for requests whose `Origin`/`Referer` matches `SANCTUM_STATEFUL_DOMAINS`. The callback comes from `accounts.google.com`, so under the `api` group there is no session: the `state` cannot be read back and `Auth::login()` writes to a session nobody persists. The alternative (`api.php` + `->middleware('web')`) makes Sanctum's inner pipeline and the outer `web` group both run `EncryptCookies`/`ValidateCsrfToken`, and behave differently on the two routes of one flow. | A `why` comment at the route registration naming the Sanctum mechanism. Both routes are `GET`, so the `web` group's CSRF middleware is a no-op. The `/api/` prefix keeps production nginx's explicit `^/(api\|up\|sanctum)` block routing them, and `web.php`'s catch-all already excludes the `api` segment. Quickstart §4.1 exercises the real browser path the tests cannot. |
| The ID token's RS256 signature is not verified | The token is received **directly from Google's token endpoint** over TLS on a connection authenticated with our `client_secret` — OpenID Connect Core §3.1.3.7 and Google's own docs both permit skipping signature validation in exactly this case, because the channel already proves the issuer. Verifying it would mean JWKS fetching, caching and key rotation, which is the part that would genuinely justify a package and would buy nothing. | `iss`, `aud` and `exp` are hard-checked with no leeway, with a dedicated test per claim. The token never traverses the browser: only `code` and `state` come off the query string. `access_type=online` means no refresh token exists to be mishandled, and the `access_token` is read by nothing. If Google ever moved the ID token onto the browser redirect (implicit/hybrid), this reasoning would collapse — which is why the flow is pinned to `response_type=code`. |
| `users.password` loses `NOT NULL` | FR-020 requires accounts with no password, so the constraint cannot survive. `Hash::check()` already fails closed on a `null` hash, so `Auth::attempt()` cannot succeed — but that is **framework behaviour**, and a security requirement resting on an unasserted framework internal is one upgrade from being false. | `contracts/password-login-invariant.md` is a standalone checklist: `LoginRequest` still requires the field (422 before any attempt), the passwordless `401` must be byte-identical to the wrong-password `401` (SC-008), and `Hash::check('', null) === false` is asserted directly. The 007–015 suites are the SC-007 regression gate and may not be edited. |
| The Google round trip is not covered by e2e | CI has no Google, and standing up a fake IdP would be a larger artifact than the feature it tests. | The gap is named, not hidden. Everything below the network boundary is covered by feature tests with `Http::fake()` — including the `aud`/`iss`/`exp` rejections, all seven error codes, and every resolution branch. The e2e spec covers what it honestly can (presence, accessible name, keyboard, 320 px, both appearances), which is possible only because the button renders unconditionally (research D12). `quickstart.md` §4 is a six-scenario manual walkthrough against a real Google client, and is on the definition of done. |
