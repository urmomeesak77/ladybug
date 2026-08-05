# Phase 1 Data Model — "Remember Me" Login Session Persistence

**Feature**: `018-remember-me-login` | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

No new tables, no new columns, no migration. Per [D2](./research.md#d2--mechanism-a-companion-cookie-that-retunes-sessionlifetime-per-request-not-laravels-stock-remember_token-recaller),
the entire feature is carried by request-scoped config and two cookies. This document records
the two cookies as the closest thing this feature has to persisted entities, plus the one
request-shape change.

---

## 1. The session cookie (existing, unchanged in kind — only its lifetime varies)

| | |
|---|---|
| Name | `online-trash-session` (`Str::slug(APP_NAME).'-session'`, `config/session.php:132-135`, unchanged) |
| Set by | Laravel's `StartSession` middleware, on every response |
| Lifetime | `config('session.lifetime')` minutes — **120 (default)** for a normal login, **10080 (7 days)** for the duration of a request where the remember flag cookie (§2) is present |
| Cleared by | `AuthController::logout()` (`session()->invalidate()`), `EnsureAccountEnabled` (disabled-account teardown) — both unchanged |

This is the Session entity from `spec.md`'s Key Entities section: "carries an expiration that is
either the product's normal duration, or... a sliding 7-day-since-last-activity duration." The
expiration itself is not a stored value anywhere — it's derived each request from
`config('session.lifetime')` at the moment the session file's mtime (or, for `database`, its
`last_activity`) is checked, which is exactly why it can slide for free once the config value is
right (D1).

## 2. The remember flag cookie (NEW)

| | |
|---|---|
| Name | `online-trash-remember` (`config('remember.cookie')`, D6) |
| Value | An opaque non-empty marker (e.g. `"1"`) — **presence, not content, is what's checked** (D3); it carries no user id, token, or secret |
| Set by | `AuthController::login()`, only when `remember` was `true` in the request and credentials succeeded (D4) |
| Lifetime | `config('remember.lifetime')` minutes — 10080 (7 days) by default (D6) |
| Renewed by | A new middleware, on every authenticated request where the cookie is present — re-queued with a fresh 7-day `Max-Age` each time (D2 step 3), which is what makes the whole feature "sliding since last activity" (FR-004) rather than "7 days from login" |
| Cleared by | `AuthController::logout()` and `EnsureAccountEnabled`'s disabled-account teardown, alongside their existing session invalidation (D2 step 4) |
| Read by | A new early middleware, before the session is started, purely to decide whether to raise `config('session.lifetime')` for that request (D3) |

No relationship to `users.remember_token` (`0001_01_01_000000_create_users_table.php:27`) — that
column stays exactly as unused as it is today; this feature does not read or write it (D2).

## 3. `LoginRequest` — one new optional field

| Field | Type | Rule | Default |
|---|---|---|---|
| `remember` | boolean | `sometimes`, `boolean` | absent → treated as `false` |

No new validation error surface: a non-boolean value (e.g. a string that isn't `"true"`/`"false"`/
`0`/`1`) fails the existing `boolean` rule with Laravel's standard message, handled by the
login form's existing 422 field-error path — no new frontend error case needed since the
checkbox can only ever submit `true`/`false`.

## 4. State transitions

```
                     login (remember=false)          logout / disabled
  [anonymous] ──────────────────────────────► [session, 120min sliding] ──► [anonymous]

                     login (remember=true)
  [anonymous] ──────────────────────────────► [session, 7d sliding] ───┐
                                                        ▲               │ any authenticated
                                                        │               │ request (renews
                                                        └───────────────┘ both cookies)
                                                        │
                                            logout / disabled / 7d idle
                                                        ▼
                                                  [anonymous]
```

There is no third, distinct "remembered but currently lapsed" state to model: once either cookie
is gone (7 days idle, or explicit logout, or the disabled-account teardown), the next request
simply finds no valid session — identical to the anonymous path the app already has.
