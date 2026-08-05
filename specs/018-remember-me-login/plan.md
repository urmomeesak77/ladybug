# Implementation Plan: "Remember Me" Login Session Persistence

**Branch**: `018-remember-me-login` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-remember-me-login/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add an opt-in "Remember me" checkbox to the login form. Checked: the session's idle-expiration
window becomes a sliding 7 days (reset by every authenticated request) instead of the product's
normal 120 minutes. Unchecked: today's behavior, byte-for-byte unchanged. No new database table
or column — the existing session cookie's lifetime is retuned per-request via a small companion
"remember" flag cookie and two new middleware, because Laravel's existing sliding-expiration
machinery already does the hard part (it just needs a different number fed to it for sessions
that opted in). Full mechanism and the two rejected alternatives (Laravel's stock long-lived
recaller cookie; switching to the `database` session driver) are in [research.md](./research.md).

## Technical Context

**Language/Version**: PHP 8.2+ (backend, Laravel 12), TypeScript (frontend, React 18 + Vite)

**Primary Dependencies**: Laravel 12 + Sanctum (SPA cookie-session auth, already in use — no new
package); React 18 + React Router (frontend, already in use — no new package)

**Storage**: MySQL via Eloquent — **unchanged by this feature**; no new migration. The feature's
only "storage" is two HTTP cookies (research D2, D6).

**Testing**: PHPUnit (backend, `backend/tests/`), Vitest (frontend, `frontend/tests/`) — both
existing toolchains, ≥90% coverage gate (Constitution VII)

**Target Platform**: Existing Docker stack (php-fpm backend, nginx+SPA frontend); no Octane/
Swoole (verified in research D3 — a per-request `config()` mutation is safe)

**Project Type**: Web application (existing `backend/` + `frontend/` split)

**Performance Goals**: N/A beyond existing login/request latency — this feature adds one cookie
read and, at most, one cookie write per request; no measurable overhead

**Constraints**: Must not change the default (non-remembered) sign-in duration in any way
(FR-003/SC-003); must integrate with the existing disabled-account teardown
(`EnsureAccountEnabled`, feature 012) without modifying its documented scope

**Scale/Scope**: One backend endpoint's request shape (`POST /api/login`), two new small backend
classes (a config file + a support class), two new middleware, one frontend checkbox — small,
single-feature scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Minimal Dependencies | **PASS** | Zero new npm/Composer packages. New surface is one `backend/config/remember.php`, one `App\Support\RememberMe` class, two small middleware, and a frontend checkbox — all using the existing Laravel/React stack (research D2, D6). |
| II. Coding Conventions | **PASS** | New PHP stays under 30 lines/function, `declare(strict_types=1)`, PSR-12; new/touched TS stays under 50 lines/function, 2-space/semicolons. No deviation planned. |
| III. Browser-Native Navigation | **N/A** | No new routes or views; login page URL and navigation behavior are unchanged. |
| IV. Theme & Accessibility | **PASS** | The new checkbox gets a real, visible `<label>` (not `sr-only` — Remember me benefits from being read, unlike the existing placeholder-style fields) and is a native `<input type="checkbox">`, keyboard-operable by default; no color-only signal introduced. |
| V. Stable Meme Identifiers | **N/A** | Feature touches auth/session only, not memes. |
| VI. Security & Input Validation | **PASS** | `remember` is validated (`sometimes`, `boolean`) server-side; the flag cookie carries no secret/identity (presence-only, research D3) so it cannot be forged into extra privilege — worst case a forged cookie only makes the *existing, already-authenticated* session's cookie live longer, never grants auth by itself. Disabled-account rejection (FR-006) reuses the existing `EnsureAccountEnabled` teardown path unmodified in scope, only extended to also clear the new cookie. |
| VII. Test Coverage & Organization | **PASS (planned)** | New/changed code (`AuthController`, `LoginRequest`, the two new middleware, `RememberMe` support class, `LoginPage`, `authApi.ts`) gets mirrored tests under `backend/tests/` and `frontend/tests/` per `/speckit-tasks`; happy path (US1–US3) and edge cases (logout, disabled account, cross-device independence) both covered per `quickstart.md`. |
| VIII. Responsive, Multi-Device Layout | **PASS** | One checkbox+label added to an existing, already-responsive auth form; no new layout structure. |

No violations — Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/018-remember-me-login/
├── plan.md                          # This file (/speckit-plan command output)
├── research.md                      # Phase 0 output (/speckit-plan command)
├── data-model.md                    # Phase 1 output (/speckit-plan command)
├── quickstart.md                    # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── login-endpoint.md            # Phase 1 output (/speckit-plan command)
└── tasks.md                         # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing decoupled `backend/` (Laravel 12) + `frontend/` (React 18 + Vite) layout, unchanged.
This feature touches:

```text
backend/
├── config/
│   └── remember.php                       # NEW — cookie name + lifetime (D6)
├── app/
│   ├── Support/
│   │   └── RememberMe.php                 # NEW — queue()/forget() the flag cookie (D2, D6)
│   ├── Http/
│   │   ├── Controllers/
│   │   │   └── AuthController.php         # EDIT — login() queues/raises lifetime; logout() forgets
│   │   ├── Middleware/
│   │   │   ├── ApplyRememberMeLifetime.php  # NEW — pre-session: raise session.lifetime (D3)
│   │   │   ├── SlideRememberMeCookie.php    # NEW — post-auth: renew the flag cookie (D2 step 3)
│   │   │   └── EnsureAccountEnabled.php     # EDIT — also forgets the flag cookie on teardown
│   │   └── Requests/
│   │       └── LoginRequest.php           # EDIT — 'remember' => ['sometimes', 'boolean']
│   └── bootstrap/app.php                  # EDIT — register the two new middleware (D3 ordering)
└── tests/
    ├── Feature/Http/Controllers/AuthControllerTest.php   # EDIT — remember-me cases
    ├── Feature/Http/Middleware/                            # NEW — the two new middleware
    └── Unit/Support/RememberMeTest.php                     # NEW

frontend/
├── src/
│   ├── pages/
│   │   └── LoginPage.tsx              # EDIT — checkbox + local remember state
│   └── lib/
│       └── authApi.ts                 # EDIT — LoginInput gains `remember: boolean`
└── tests/
    └── pages/LoginPage.test.tsx       # EDIT — checkbox default/submit behavior
```

**Structure Decision**: No new top-level directories. The feature is additive within the
existing `backend/app/Http/{Controllers,Middleware,Requests}`, one new `backend/app/Support`
class (matching the existing `MediaPath` pattern there), one new `backend/config/*.php` file
(matching `session.php`'s own env-driven pattern), and a single-page frontend edit. Tests mirror
source exactly per Constitution Principle VII.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations recorded — the Constitution Check above passed on every applicable principle with
no exceptions, so this table is intentionally empty.
