# Contract: Auth API

Base origin is environment-configured (`VITE_API_BASE_URL` on the client). All endpoints
exchange JSON and participate in Sanctum SPA cookie-session auth: the client MUST send
`credentials: 'include'` and, for unsafe methods, the `X-XSRF-TOKEN` header read from the
`XSRF-TOKEN` cookie.

## CSRF priming

### `GET /sanctum/csrf-cookie`
- Provided by Sanctum. Returns `204` and sets the `XSRF-TOKEN` cookie.
- The client calls this once before the first unsafe auth request (login/register/logout).

## Endpoints

### `POST /api/register`
- **Body**: `{ name, email, password, password_confirmation }`.
- **201**: `{ data: { id, name, email, created_at, updated_at } }`; a session cookie is
  established (user is logged in).
- **422**: `{ message, errors: { <field>: [msg, ...] } }` — validation failure
  (e.g. `email` already taken, weak/mismatched password).
- Side effects: creates exactly one user (password hashed). No verification email is sent
  (out of scope).

### `POST /api/login`
- **Body**: `{ email, password }`.
- **200**: `{ data: { id, name, email, created_at, updated_at } }`; session established.
- **401**: `{ message: "These credentials do not match our records." }` — single generic
  message for wrong email **or** password (no disclosure, D5).
- **422**: `{ message, errors }` — malformed/missing fields only.

### `POST /api/logout`
- **Auth**: requires a valid session (`auth:sanctum`).
- **200**: `{ message: "Logged out." }`; session invalidated and cookie cleared.
- **401**: when called without a valid session.

### `GET /api/user`
- **Returns the current user without erroring when anonymous** (FR-005). Two acceptable
  shapes, pick one and keep it consistent (the client handles it in `fetchCurrentUser`):
  - Authenticated → `200 { data: { id, name, email, created_at, updated_at } }`.
  - Anonymous → `200 { data: null }`.
- Implementation note: to return `200 {data:null}` for anonymous, the route is **not**
  behind `auth:sanctum`; the controller reads `$request->user()` (nullable) and returns
  `null` when absent. (A `401` from a guarded route is the alternative; the client treats
  both `data:null` and `401` as `anonymous`.)

## Security invariants (apply to all)
- Passwords are hashed (`password` cast) and never returned, logged, or echoed.
- All DB access via Eloquent (parameterized) — no raw SQL (Principle VI).
- Validation is server-side and authoritative; client validation is convenience only.
- Secrets and origins (stateful domains, session domain, app key) come from env only.
- Login does not reveal whether an email is registered (no `exists` rule, generic 401).

## Routes registered (`routes/api.php`)
```
POST /api/register  → AuthController@register   (stateful, CSRF)
POST /api/login     → AuthController@login       (stateful, CSRF)
POST /api/logout    → AuthController@logout      (auth:sanctum)
GET  /api/user      → AuthController@user         (nullable user)
```
Sanctum's `GET /sanctum/csrf-cookie` is provided by the package, not declared here.
