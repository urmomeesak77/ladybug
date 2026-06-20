# Phase 0 Research: Authentication (Full-Stack)

Decisions that resolve the spec's deferred/plan-time questions and the Technical Context
unknowns. Format per decision: **Decision / Rationale / Alternatives**.

## D1 — Sanctum authentication mode: SPA cookie session (not bearer tokens)

**Decision**: Use Laravel Sanctum's **SPA authentication** (first-party, cookie-based
session + CSRF), not personal access (bearer) tokens. The SPA calls
`GET /sanctum/csrf-cookie` once, then `POST /api/login` / `POST /api/register` establish a
`laravel_session` cookie; protected requests send the cookie via `credentials: 'include'`.

**Rationale**:
- **Refresh survival (FR-013) & backend-derived state (FR-014)**: an HttpOnly session
  cookie persists across reloads, so `GET /api/user` on app load rehydrates auth state
  without any client-stored credential.
- **Security (Principle VI)**: no token in JS/localStorage → no XSS token-exfiltration
  surface; CSRF is handled by Sanctum's cookie + `X-XSRF-TOKEN` flow.
- It is the Laravel-documented pattern for a first-party SPA, keeping us on the baseline
  stack with no extra moving parts beyond config.

**Alternatives considered**:
- *Bearer tokens (prototype's approach)*: token returned in JSON / a non-HttpOnly cookie.
  Rejected — to survive refresh the token must be persisted in JS-readable storage
  (XSS-exposed) or a cookie we manage manually; more code, weaker security.
- *Pure hand-rolled session auth without Sanctum*: contradicts the constitution's named
  baseline and loses Sanctum's CSRF/stateful-domain plumbing.

## D2 — Installing `laravel/sanctum`

**Decision**: Add `laravel/sanctum` to `composer.json` `require`, publish its config, and
enable the stateful API middleware (`$middleware->statefulApi()` in `bootstrap/app.php`).

**Rationale**: Sanctum is the constitution's *named baseline* auth stack but was never
actually installed. This is baseline alignment, not a new-dependency decision (logged in
plan Complexity Tracking). No other dependency is added.

**Alternatives**: none viable — see D1.

## D3 — Validation rules (parity with prototype, constitution-aligned)

**Decision**: Server-side form requests mirror the prototype:
- **Register**: `name` required|string|max:255; `email` required|email|unique:users|max:255;
  `password` required|string|min:8|mixed-case|numbers|confirmed.
- **Login**: `email` required|email; `password` required|string. (No `exists` rule on
  email — see D5.)

**Rationale**: Matches the prototype's `RegisterRequest`/`LoginRequest` for behavioral
parity; satisfies FR-002. Client-side validation in `authModel.ts` mirrors these for
fast feedback but the server remains authoritative.

**Alternatives**: looser rules (rejected — weaker accounts); stricter bespoke policy
(rejected — unnecessary divergence from parity reference).

## D4 — "Uncompromised" (HaveIBeenPwned) password check: OUT for now

**Decision**: Do **not** include `Password::uncompromised()`.

**Rationale**: It performs an outbound HTTP call to an external service (k-anonymity
range API). That is an external integration with availability/privacy/test-flakiness
implications and is unnecessary for an MVP; the strength policy (length + mixed case +
numbers) is retained. Revisit as a separate, explicitly-approved enhancement.

**Alternatives**: enable it now (rejected — external dependency + flaky tests for little
MVP value); custom blocklist (rejected — scope creep).

## D5 — Non-disclosing login failure (anti-enumeration)

**Decision**: Login validates only *format* (`email`/`password` present and well-formed),
then attempts authentication; a wrong email **or** wrong password yields a single
`401` with one generic message ("These credentials do not match our records."). The
login form request MUST NOT use `exists:users,email` (which would leak which emails are
registered).

**Rationale**: Satisfies FR-003 and the duplicate-email edge case without enumeration.
Note this is a deliberate divergence from the prototype's `LoginRequest`, which used
`exists:users,email` — the constitution's security principle wins.

**Alternatives**: distinct "no such user" vs "wrong password" messages (rejected —
enables account enumeration).

## D6 — CORS / stateful domains / cookies (dev + prod)

**Decision**: Publish `config/cors.php` with `supports_credentials => true` and paths
covering `api/*` and `sanctum/csrf-cookie`; set `SANCTUM_STATEFUL_DOMAINS`,
`SESSION_DOMAIN`, and the frontend origin via **env vars** (never committed). Dev uses
`localhost`-based origins, which Sanctum treats as stateful.

**Rationale**: SPA cookie auth across the decoupled dev origins requires credentialed
CORS and matching stateful-domain config; secrets/origins live in env per Principle VI.
`.env.example` documents the new keys.

**Alternatives**: wildcard CORS with credentials (rejected — disallowed by the spec and
by browsers when credentials are included).

## D7 — Frontend auth state: React context + on-load rehydrate

**Decision**: A single `useAuth` context hook holds `status`
(`unknown` → `anonymous` | `authenticated`) and the current `user`. On mount it calls
`fetchCurrentUser()`; `unknown` gates guard redirects so no guard fires before the
session check resolves (prevents a flash-redirect on refresh of `/account`).

**Rationale**: Centralizes backend-derived state (FR-014), makes guards and NavMenu
trivial, and handles the refresh case cleanly (FR-013). The pure pieces (request
wrappers + state/validation logic) live in `src/lib` for coverage; the context is thin
glue.

**Alternatives**: per-page fetching (rejected — duplicated logic, redirect flicker);
a state library (rejected — Principle I, unnecessary).

## D8 — Test strategy & coverage placement

**Decision**:
- *Backend*: PHPUnit Feature tests (`RefreshDatabase`, SQLite `:memory:`) exercise all
  four endpoints incl. edge cases (duplicate email, weak/mismatched password, bad
  credentials → 401 non-disclosing, unauth `GET /api/user`, logout revokes session,
  CSRF). Unit test for `UserService` (creation + hashing + dup-email retry/throw).
  Coverage spans all of `app/` (per `phpunit.xml`), so each new class is ≥90%.
- *Frontend*: Vitest unit tests for `authApi.ts` (mocked `fetch`: 200/201/401/422/network,
  asserts `credentials:'include'` and CSRF header) and `authModel.ts` (state transitions,
  field validation, server-error mapping). These live in `tests/lib/**` (the ≥90% scope).
  Pages/guards/NavMenu are thin glue verified per the manual gate.

**Rationale**: Honors Principle VII and the existing coverage scoping on both stacks;
`mockery` is already approved/present for backend tests.

**Alternatives**: testing React pages for coverage (rejected — out of the established
`src/lib`-only frontend coverage scope; would pull in component-testing tooling).

## D9 — Out-of-scope confirmations

Password reset, email verification (the `Registered` event / mail from the prototype),
profile editing, "remember me", and OAuth are **out of scope** (spec "Out of Scope").
Registration creates the user and logs them in; no verification email is sent in this
feature.
