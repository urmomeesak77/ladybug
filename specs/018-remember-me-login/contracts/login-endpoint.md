# Contract: `POST /api/login`

**Feature**: `018-remember-me-login` | **Research**: [research.md](../research.md#d4--login-endpoint-contract-one-new-optional-boolean-field)

This extends the existing endpoint (behavior established in `007-auth-ui`); only the `remember`
field and its cookie side-effect are new. Everything else — the 401 on bad credentials, the 403
on a disabled account, the generic non-disclosing failure message — is unchanged.

## Request

```
POST /api/login
Content-Type: application/json
X-XSRF-TOKEN: <csrf token>
```

```json
{
  "email": "user@example.com",
  "password": "correct-horse",
  "remember": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | unchanged |
| `password` | string | yes | unchanged |
| `remember` | boolean | **no** (NEW) | absent or `false` → today's behavior, unaffected |

## Responses

### `200` — success (remember true or false)

Unchanged body — `UserResource`, same as today:

```json
{ "data": { "hash": "...", "name": "...", "email": "...", "role": "member", "...": "..." } }
```

**New side effect when `remember: true`**: the response also carries a `Set-Cookie` for the
remember flag cookie (`config('remember.cookie')`, 7-day `Max-Age`), in addition to the existing
session cookie's `Set-Cookie` — which itself carries a 7-day `Max-Age` instead of the usual
120-minute one for this response (D2/D3). When `remember` is absent or `false`, only the
existing session cookie is set, at its usual 120-minute `Max-Age` — byte-for-byte the same
response this endpoint already produces today (FR-003, SC-003).

### `401` — bad credentials

Unchanged: `{"message": "These credentials do not match our records."}`. The `remember` field
plays no role in credential verification — it is only consulted after `Auth::attempt` succeeds.

### `403` — disabled account

Unchanged: `{"message": "This account is disabled."}`, and the just-established session is torn
down exactly as today. No remember cookie is ever queued on this path (the disabled check runs
before the remember-handling — D4), so a disabled account can never end up with a lingering
remember cookie from a login attempt.

### `422` — validation failure

Unchanged shape (`{"errors": {"field": ["message"]}}`); `remember` only appears here if a
non-boolean value was submitted (not reachable from the checkbox UI, only from a malformed
direct API call).

## `POST /api/logout` (existing endpoint, no request/response shape change)

**New side effect**: in addition to today's session teardown, the remember flag cookie (if
present) is cleared (`Cookie::forget`) — FR-005, "manual sign-out ends the session immediately...
the 7-day allowance never overrides an explicit sign-out."

## Every other endpoint (existing middleware, no route/shape change)

**New side effect**: on every request through the `api` middleware group, if the remember flag
cookie is present and the resolved user is not disabled, that cookie is re-queued with a fresh
7-day `Max-Age` (FR-004, sliding window). If `EnsureAccountEnabled` rejects the request (disabled
account, unchanged `401` contract from `012-admin-user-list`), the remember cookie is cleared
instead of renewed (FR-006).
