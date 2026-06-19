# Phase 1 Data Model: Authentication (Full-Stack)

No new database tables or columns are introduced; the existing `users` table satisfies
the feature. This document captures the entities, validation rules, and state machines
the code must honor.

## Entity: User (existing `users` table)

| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint PK | Internal only — **never** placed in a URL or relied on as a public handle. |
| `name` | string(255) | Display name. Required at registration. |
| `email` | string(255), unique | Login identifier. Unique, well-formed. |
| `password` | string (hash) | Stored hashed (`password` cast = `hashed`). **Never** serialized (`$hidden`). |
| `email_verified_at` | datetime, nullable | Present in schema; unused by this feature (verification out of scope). |
| `created_at` / `updated_at` | datetime | Exposed in the public profile. |

**Public representation** (`UserResource`): `{ id, name, email, created_at, updated_at }`.
Excludes `password`, `remember_token`, and any other sensitive field (FR-007, SC-009).

No schema migration is required. The prototype's extra `users.hash` column is **not**
adopted — auth needs no public user code, and adding one would be unused scope.

## Validation rules

### Registration (`RegisterRequest`)
- `name`: required, string, max 255.
- `email`: required, valid email, `unique:users,email`, max 255.
- `password`: required, string, min 8, mixed case, at least one number, `confirmed`
  (matching `password_confirmation`).
- Failure → `422` with per-field messages (Laravel default validation error shape).

### Login (`LoginRequest`)
- `email`: required, valid email. (No `exists` rule — anti-enumeration, D5.)
- `password`: required, string.
- Format failure → `422`; credential mismatch → `401` generic (see state machine).

### Client-side mirror (`authModel.ts`)
Pure functions validate the same rules for instant feedback (empty fields, email shape,
password length/variety, confirmation match) but never replace server validation. Server
`422` errors are merged into the field-error map so backend messages win.

## Session / credential (Sanctum SPA)

Opaque to the frontend. Lifecycle:

- **CSRF priming**: `GET /sanctum/csrf-cookie` sets the `XSRF-TOKEN` cookie consumed on
  subsequent unsafe requests.
- **Established** by successful `register` or `login` (session cookie issued).
- **Read** by `GET /api/user` (returns the user when the session is valid).
- **Revoked** by `POST /api/logout` (session invalidated; cookie cleared).
- **Expiry**: default Laravel session lifetime; an expired/absent session makes
  `GET /api/user` return the unauthenticated result and protected endpoints `401`.

## Frontend auth state machine (`authModel.ts`)

```
        ┌─────────┐  fetchCurrentUser() pending
        │ unknown │  (initial; on app load / refresh)
        └────┬────┘
   200 user  │  401 / network
      ┌──────┴───────┐
      ▼              ▼
┌─────────────┐  ┌───────────┐
│authenticated│  │ anonymous │
└─────────────┘  └───────────┘
   ▲   │ logout()        │ login()/register() success
   │   └─────────────────┘
   └─────────────────────┘
```

- `unknown` is the gate state: route guards and NavMenu MUST treat `unknown` as
  "still resolving" (render nothing/spinner, do **not** redirect) so a refresh of
  `/account` does not flash a redirect before the session check completes (D7, FR-013).
- A `401` from any protected call transitions an `authenticated` session to `anonymous`
  (handles server-side expiry/revocation; edge case "expired/revoked session").

## Form submission state (per form)

`idle → submitting → (success | fieldErrors | authError | networkError)`.
- `submitting` disables the submit control (FR-019, double-submit guard).
- `fieldErrors` populates inline per-field messages (from client checks or server `422`).
- `authError` (login only) shows the single non-disclosing banner.
- `networkError` shows a distinct retryable banner without clearing non-password fields
  (FR-009, FR-018 — password fields are always cleared/never echoed).
