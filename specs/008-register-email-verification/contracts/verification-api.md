# Contract: Email Verification API

**Feature**: 008-register-email-verification | **Base**: existing JSON API under `/api`

Both endpoints ride the Sanctum SPA cookie session established by 007 (CSRF
cookie + `credentials: 'include'`; unsafe methods carry `X-XSRF-TOKEN`).

## GET `/api/email/verify/{hash}`

Fulfills a verification link. Route name **`verification.verify`** (the
`createUrlUsing` callback — a static class method, not a closure — signs
against this name).

`{hash}` is `sha1` of the recipient's email — **no user id or public code
appears in the URL** (owner requirement, research D3). Session-free since
2026-07-08 (D3 amendment): anonymous requests resolve the account from the
digest itself (indexed `users.email_sha1`); when a session IS present, the
digest must be the signed-in user's own (`VerifyEmailRequest`, `hash_equals`)
— a different signed-in account is refused.

**Middleware**: `signed:relative`, `throttle:6,1` (per user when signed in,
per IP otherwise)

**Query**: `expires` (unix ts), `signature` (hex HMAC) — produced by the
notification; the SPA forwards them verbatim from the email link.

| Status | When | Body |
|--------|------|------|
| `200` | Link valid; account was unverified and is now verified — or was already verified (idempotent, FR-005) | `{ "data": <user>, "meta": { "already_verified": false \| true } }` — `<user>` is the standard `UserResource` payload with fresh `email_verified_at` |
| `403` | Signature invalid or expired (`signed:relative`), the digest doesn't match the authenticated user's email (`VerifyEmailRequest` — covers cross-account use), **or** the digest matches no account (deleted / address changed) | `{ "message": ... }` — account state unchanged (FR-004, SC-003) |
| `429` | More than 6 hits/min | Laravel default throttle body + `Retry-After` |

## POST `/api/email/verification-notification`

Sends a fresh verification message to the authenticated user (US2).

**Middleware**: `auth:sanctum`, `throttle:6,1`

**Request body**: none.

| Status | When | Body |
|--------|------|------|
| `200` | User was unverified; a new message was dispatched | `{ "message": "Verification link sent." }` |
| `409` | User is already verified — nothing to send | `{ "message": "Email already verified." }` |
| `401` | No authenticated session | Laravel default |
| `429` | Beyond 6 requests/min per user (FR-006, SC-005) | Laravel default throttle body + `Retry-After` |

## Changed payloads on existing endpoints

`UserResource` gains `email_verified_at` (ISO-8601 string or `null`), so the
verification status now appears in:

- `POST /api/register` → `201 { data: { …, "email_verified_at": null } }`
- `POST /api/login` → `200 { data: { …, "email_verified_at": <ts|null> } }`
- `GET /api/user` → `200 { data: { …, "email_verified_at": <ts|null> } }` (or `{ data: null }` anonymous)

## Registration side effect (behavioral contract)

`POST /api/register` additionally dispatches the verification email to the new
address, synchronously, inside the request (SC-001). A mail-transport failure
is reported server-side and **does not change the response**: the account is
created and `201` returned regardless (FR-011); recovery is the resend
endpoint.

## The emailed link

The message (built-in `VerifyEmail` notification, `log` transport in dev/e2e)
contains:

```text
{FRONTEND_URL}/verify-email/{hash}?expires={unix}&signature={hmac}
```

- `{hash}` = `sha1` of the recipient's email; no ids of any kind in the link.
- Signature covers the **relative** API route
  `/api/email/verify/{hash}?expires=…`, so it validates regardless of the
  origin the SPA runs on (research D3).
- Lifetime: 24 h (`config/auth.php` → `verification.expire = 1440`, FR-002).
- `FRONTEND_URL` env: dev `http://localhost:5173`, e2e `http://localhost:5174`.
