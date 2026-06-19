# Implementation Plan: Authentication (Full-Stack — Auth API + Login/Register/Account UI)

**Branch**: `007-auth-ui` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-auth-ui/spec.md`

## Summary

Add end-user authentication as one full-stack slice. The backend gains a Sanctum-backed
auth API — `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/user` —
and the frontend gains `/register`, `/login`, and `/account` pages wired into the
existing site layout, plus auth-aware navigation and route guards.

Technical approach: **Sanctum SPA cookie-session authentication** (not bearer tokens).
The SPA acquires a CSRF cookie, then login/register establish a first-party session
cookie; `GET /api/user` rehydrates auth state on every load so a browser refresh keeps
the user logged in (FR-013) and auth state is always derived from the backend (FR-014).
This avoids storing credentials in JS (XSS surface) and is the Laravel-documented SPA
pattern. The earlier prototype's token-in-cookie approach is the parity reference for
*fields and flows*, not the transport.

Backend logic stays testable and small: `AuthController` is thin glue over a
`UserService` (user creation + hashing) with `RegisterRequest`/`LoginRequest` form
requests and a `UserResource` for safe output. Frontend pure logic (the auth API client
and an auth state/validation model) lands in `frontend/src/lib` under the existing ≥90%
coverage scope; pages, the auth context hook, and route guards are thin glue verified
manually, mirroring the 005/006 split.

**Dependency note:** `laravel/sanctum` is **not yet in `composer.json`** despite being
the constitution's named baseline auth stack. Installing it brings the repo in line with
its own declared stack rather than introducing a new choice; it is recorded under
Complexity Tracking for transparency. No other runtime dependency is added.

## Technical Context

**Language/Version**: PHP 8.2 (`declare(strict_types=1)`, PSR-12) on Laravel 12;
TypeScript ~5/6 (strict) on React 18.3 built with Vite.

**Primary Dependencies**: Backend — Laravel 12 + **laravel/sanctum** (to be installed;
constitutional baseline). Frontend — React 18 + `react-router-dom` (already present);
HTTP via native `fetch` with `credentials: 'include'`. No new frontend dependency.

**Storage**: MySQL via Eloquent (dev/prod); the existing `users` table is the account
store. No schema change is required — `name`, `email` (unique), `password` already exist.
Sanctum SPA mode uses the session/cookie, not the `personal_access_tokens` table, so that
migration is optional and out of scope unless token auth is later added.

**Testing**: Backend PHPUnit on SQLite `:memory:` (per `phpunit.xml`) with
`RefreshDatabase`; `mockery/mockery` already approved/present. Coverage is measured over
all of `app/` (`<source><include>app</include>`), so `AuthController`, `UserService`,
requests, and resource must each be ≥90% covered. Frontend Vitest with coverage scoped to
`src/lib/**/*.ts` (≥90% lines) — auth API client + auth model are unit-tested there with
mocked `fetch`, like `tests/lib/api.test.ts`.

**Target Platform**: Decoupled web app — Vite SPA (≈320px → wide desktop, evergreen
browsers) over JSON to the Laravel API. Dev origins are `localhost:5173` (frontend) and
the backend container; both are `localhost`, which Sanctum treats as a stateful domain.

**Project Type**: Web application — `backend/` Laravel API + `frontend/` React SPA. This
feature touches **both** apps.

**Performance Goals**: Registration → logged-in in under 1 minute for valid input
(SC-001); auth endpoints respond well within typical web latency; the on-load
`GET /api/user` rehydration is a single small request.

**Constraints**: Minimal dependencies (Principle I) — only the baseline Sanctum is added;
real shareable URLs with native Back/Forward/Refresh and redirect rules (Principle III,
FR-008/FR-012/FR-013); `prefers-color-scheme` theming, labels + `aria-*` errors, color
never the sole signal (Principle IV, FR-015/FR-016); server-side validation, hashed
passwords, parameterized Eloquent, escaped output, non-disclosing login error, secrets in
env, CSRF via Sanctum (Principle VI, FR-001..FR-007/FR-018); ≥90% coverage both stacks
(Principle VII, SC-010); responsive 320px→desktop with adequate touch targets
(Principle VIII, FR-017).

**Scale/Scope**: 4 backend endpoints; ~1 controller + 1 service + 2 form requests + 1
resource + config/middleware wiring; frontend ~2 new `src/lib` modules (auth API client,
auth model), 1 auth context hook, 2 route-guard wrappers, 3 pages, NavMenu edit, App
routing edit, CSS, and mirrored tests on both stacks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Minimal Dependencies | New deps need approval + rationale | **PASS (with note)** — only `laravel/sanctum` is added, and only because it is the constitution's *named baseline* auth stack that the repo was missing; no other dep. Frontend adds none (native `fetch`, existing router). Recorded in Complexity Tracking. |
| II. Coding Conventions | PSR-12/4-space/strict_types, PHP fns <30 lines; 2-space/semicolons/camelCase, JS fns <50 lines; brace single-line bodies; comments explain *why* | **PASS (planned)** — thin controller over a service keeps PHP methods small; pure lib funcs keep TS small; Pint + ESLint + lint-reviewer enforce. |
| III. Browser-Native Navigation | Real URLs, Back/Forward/Refresh restore, deep-linkable | **PASS** — `/login`, `/register`, `/account` are real routes; refresh rehydrates via `GET /api/user`; redirect rules (FR-012) implemented as router guards; no SPA-only dead ends. |
| IV. Theme & Accessibility | `prefers-color-scheme`; color not sole signal; alt/labels/aria | **PASS** — pages use the shared layout theming; every input has a `<label>`; errors use `aria-describedby`/`aria-invalid` + text/icon, never color alone. |
| V. Stable Meme Identifiers | 10-char `[A-Za-z0-9-_]` code in meme URLs | **N/A** — this feature has no meme URLs; the `User` identifier is internal and never placed in a URL. |
| VI. Security & Input Validation | Server-side validation; parameterized; escape output; secrets in env | **PASS** — all input validated in form requests; passwords hashed (`password` cast) and never returned (`$hidden` + `UserResource`); Eloquent only; login error non-disclosing (FR-003); CSRF + same-site session via Sanctum; config in env (`SANCTUM_STATEFUL_DOMAINS`, session/cookie). |
| VII. Test Coverage & Organization | ≥90%; tests mirror source under `tests/` | **PASS (planned)** — backend feature tests cover every endpoint + edge case on SQLite; unit tests cover `UserService`; all of `app/` stays ≥90%. Frontend auth client + model unit-tested under `tests/lib/**` ≥90%; pages/guards are thin glue verified per the manual gate. |
| VIII. Responsive Layout | Mobile→desktop, no horizontal scroll, fluid units, touch targets | **PASS** — forms use fluid widths/`max-width` and the shared responsive shell; controls meet touch-target sizing; verified 320px→desktop per the manual gate. |

**Initial gate: PASS** (with the Sanctum baseline note in Complexity Tracking).

**Post-Phase-1 re-check: PASS** — the designed contracts and structure (SPA cookie
session, thin controller over service, coverage-scoped lib logic, guarded routes)
introduce no further dependencies and uphold every gate above.

## Project Structure

### Documentation (this feature)

```text
specs/007-auth-ui/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output (decisions: Sanctum SPA mode, validation, etc.)
├── data-model.md        # Phase 1 output (User entity, validation rules, session/auth states)
├── quickstart.md        # Phase 1 output (run + validation guide)
├── contracts/           # Phase 1 output
│   ├── auth-api.md              # request/response contract for the 4 endpoints + CSRF
│   ├── routes.md                # /login, /register, /account behavior + redirect rules
│   └── frontend.md              # lib/hook/guard/page contracts
├── checklists/
│   └── requirements.md  # spec quality checklist (already created in /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── AuthController.php      # NEW: thin register/login/logout/user over services
│   │   ├── Requests/                   # NEW dir
│   │   │   ├── RegisterRequest.php     # NEW: name/email(unique)/password(policy, confirmed)
│   │   │   └── LoginRequest.php        # NEW: email/password required
│   │   └── Resources/
│   │       └── UserResource.php        # NEW: id, name, email, timestamps (no secrets)
│   └── Services/
│       └── UserService.php             # NEW: create(hashes password) — testable unit
├── bootstrap/app.php                   # EDIT: $middleware->statefulApi() (Sanctum SPA)
├── config/
│   ├── sanctum.php                     # NEW (published): stateful domains from env
│   └── cors.php                        # NEW (published): supports_credentials=true, paths
├── routes/api.php                      # EDIT: register/login/logout(auth)/user routes
├── composer.json                       # EDIT: require laravel/sanctum (baseline)
└── tests/
    ├── Feature/Http/Controllers/AuthControllerTest.php  # NEW: 4 endpoints + edge cases
    └── Unit/Services/UserServiceTest.php                # NEW: create + hashing + dup email

frontend/
├── src/
│   ├── lib/                            # PURE, coverage-scoped (≥90%)
│   │   ├── authApi.ts                  # NEW: csrf(), register(), login(), logout(),
│   │   │                               #   fetchCurrentUser() → typed results (validation
│   │   │                               #   errors | auth error | network), credentials:include
│   │   └── authModel.ts                # NEW: auth state (unknown/anon/authed), client-side
│   │                                   #   field validation mirroring server rules, error mapping
│   ├── hooks/
│   │   └── useAuth.ts                  # NEW: thin context glue — exposes user + actions, rehydrate
│   ├── components/
│   │   ├── NavMenu.tsx                 # EDIT: anon (login/register) vs authed (account/logout)
│   │   ├── RequireAuth.tsx             # NEW: guard — anon → redirect /login
│   │   └── RequireAnon.tsx             # NEW: guard — authed → redirect /
│   ├── pages/
│   │   ├── LoginPage.tsx               # NEW
│   │   ├── RegisterPage.tsx            # NEW
│   │   └── AccountPage.tsx             # NEW: profile + logout
│   ├── styles/theme.css                # EXTEND: auth form rules (labels, errors, fluid widths)
│   └── App.tsx                         # EDIT: AuthProvider + /login /register /account routes + guards
└── tests/
    └── lib/                            # mirrors src/lib (Principle VII)
        ├── authApi.test.ts             # NEW: mocked fetch — 200/201/401/422/network, credentials
        └── authModel.test.ts           # NEW: state transitions + field validation + error mapping
```

**Structure Decision**: Backend follows the existing thin-controller-over-service pattern
(mirroring `TrashpostsApiController` + services) with form-request validation and a JSON
resource; tests mirror source under `backend/tests`. Frontend follows the 005/006 split —
coverage-gated pure logic in `frontend/src/lib` (tests mirrored under `frontend/tests/lib`),
thin presentational glue (pages, guards, context hook) outside the coverage scope and
verified per the manual gate.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Add `laravel/sanctum` Composer dependency | The constitution names Sanctum as the baseline auth stack (Tech & Architecture Constraints) but it was never added to `composer.json`; authentication cannot be built without it. | Hand-rolling session/token auth would be *more* code, less secure, and contradict the constitution's explicit stack choice. This is baseline alignment, not a new dependency decision — and session-only (no Sanctum) would not give the documented CSRF-protected SPA cookie flow. |
