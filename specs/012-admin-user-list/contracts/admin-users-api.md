# Contract: Admin User List API

**Feature**: 012-admin-user-list | **Date**: 2026-07-20

Three endpoints, all mounted inside the existing `auth:sanctum` + `role:admin` group in
`routes/api.php` (research D10). Authentication is the Sanctum SPA cookie session; unsafe
methods carry the `X-XSRF-TOKEN` header like every other SPA mutation.

## Shared access boundary (FR-002)

Applies identically to all three endpoints — the boundary protects the **data**, not just
the SPA page:

| Caller | Response |
|---|---|
| Guest (no session) | `401` |
| Member | `403` |
| Admin, Superuser | proceeds |
| Any caller whose account is disabled | `401` + session invalidated (see §4) |

---

## 1. `GET /api/admin/users`

One page of every registered account, newest-first.

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | Non-numeric, absent, or < 1 falls back to 1. A page beyond the last returns an empty `data` array with `200` — not an error. |

**200 response** — Laravel resource collection; `meta` is the standard paginator block.

```json
{
  "data": [
    {
      "hash": "a1B2c3D4e5",
      "name": "Ada",
      "email": "ada@example.com",
      "role": "member",
      "email_verified_at": "2026-07-18 09:31:02",
      "created_at": "2026-07-18 09:30:44",
      "disabled_at": null,
      "disabled_by": null
    },
    {
      "hash": "Zz9Yy8Xx7w",
      "name": "Spammer",
      "email": "spam@example.com",
      "role": "member",
      "email_verified_at": null,
      "created_at": "2026-07-17 22:04:10",
      "disabled_at": "2026-07-19 11:20:00",
      "disabled_by": "Root"
    }
  ],
  "meta": { "current_page": 1, "last_page": 3, "per_page": 100, "total": 214 }
}
```

**Guarantees**

- Ordered `created_at DESC, id DESC` — a stable total order, so no row is skipped or
  repeated across pages.
- 100 rows per page (FR-006a). Every account state is included: unverified, disabled, and
  every role (FR-006).
- `disabled_at` and `disabled_by` are either both null or both non-null, except when the
  acting account no longer resolves, in which case `disabled_by` alone is null (FR-008a,
  data-model INV-1).
- `disabled_by` is the actor's **name**, never a database id (INV-3).
- Keys are never omitted: an absent value is explicit `null`.
- No `id`, `password`, `remember_token`, `email_sha1`, or `rating` field appears.
- `email` and `role` appear **only** here and in the existing self-profile response; this
  feature adds them to no public or member-facing payload (FR-018).

---

## 2. `POST /api/admin/users/{hash}/disable`

Revoke the target account's access. `{hash}` is the account's 10-char public handle
(FR-020); a database id is never accepted.

**Request body**: none. The acting account is taken from the session, never from the body
(FR-008b).

**200** — the updated row, same object shape as §1, so the client refreshes it in place
and keeps its page (FR-016):

```json
{
  "data": {
    "hash": "Zz9Yy8Xx7w", "name": "Spammer", "email": "spam@example.com",
    "role": "member", "email_verified_at": null, "created_at": "2026-07-17 22:04:10",
    "disabled_at": "2026-07-19 11:20:00", "disabled_by": "Root"
  }
}
```

**Errors**

| Status | When |
|---|---|
| `403` | The actor's role does not **strictly** outrank the target's — a peer, a higher rank, or the actor's own account. The target is left unchanged (FR-011). |
| `404` | No account carries that hash. |

**Semantics**

- Sets `disabled_at = now()` and `disabled_by = <actor id>` **together**.
- Set-to-target, not toggle: disabling an already-disabled account is a `200` no-op that
  keeps the original timestamp and actor, so two admins acting at once converge without
  error.
- The rank comparison is evaluated server-side, inside the transaction, against currently
  stored roles — never against client-supplied values or a stale rendering (FR-012).
- Changes nothing else: not the target's role, e-mail, verification state, password, or
  rating, and not the visibility, activation, or rating accrual of any meme it owns
  (FR-010/FR-010a).

---

## 3. `POST /api/admin/users/{hash}/enable`

Restore a disabled account. Same auth boundary, same `{hash}` semantics, same `200` row
shape and same `403`/`404` errors as §2.

**Semantics**

- Clears `disabled_at` **and** `disabled_by` together, so an active account never carries
  a stale actor reference (FR-008a).
- Set-to-target: enabling an active account is a `200` no-op.
- The account can sign in again immediately with its existing credentials — no
  re-registration and no re-verification (FR-015).

---

## 4. Cross-cutting: a disabled account cannot authenticate

Two enforcement points outside the three endpoints above.

### 4.1 Sign-in refusal — `POST /api/login` (FR-013)

Credentials are verified **first**; only a caller who proves ownership of the account
learns that it is disabled (research D4 — otherwise the login form becomes an
account-state oracle).

| Outcome | Status | Body |
|---|---|---|
| Wrong credentials | `401` | `{"message": "These credentials do not match our records."}` (unchanged) |
| Correct credentials, account disabled | `403` | `{"message": "This account is disabled."}` |
| Correct credentials, account active | `200` | the user resource (unchanged) |

The `403` path leaves no session behind: the session established by the credential check
is logged out before the response is returned.

### 4.2 Live-session revocation — every `/api/*` request (FR-014)

`EnsureAccountEnabled` runs in the api middleware group. When the resolved user carries a
non-null `disabled_at`:

- the `web` guard is logged out, the session invalidated, and the CSRF token regenerated —
  the dead cookie cannot be replayed;
- the response is `401 {"message": "This account is disabled."}`;
- this applies to **every** `/api/*` route including `POST /api/logout`, which answers `401`
  rather than its usual success; the session is already invalidated by the middleware, so the
  observable end state is the same (research D3).

This holds from the disabled account's **next request onward**, on every route including
`GET /api/user`. The SPA needs no new client code: `AuthApi.fetchCurrentUser` already maps
any non-ok response to `null`, so the session probe reads as anonymous and the UI drops to
the logged-out state.

### 4.3 Recovery flows do not re-activate a disabled account (spec → Edge Cases)

No existing account-recovery path clears `disabled_at`. Only
`POST /api/admin/users/{hash}/enable` does, and only for an actor who strictly outranks the
target.

| Flow | Route | Behaviour for a disabled account |
|---|---|---|
| Registration | `POST /api/register` | `422` — `unique:users,email` refuses the address whatever the account's state. No new row, `disabled_at` untouched. |
| Verification resend | `POST /api/email/verification-notification` | `401` — the route is `auth:sanctum`, so `EnsureAccountEnabled` (§4.2) answers before the controller and no mail is sent. |
| Verification link | `GET /api/email/verify/{hash}` | **Succeeds.** The route is deliberately session-free (`signed:relative`, 008 D3), so possession of the link still verifies the address: `email_verified_at` is set. This does **not** re-activate — `disabled_at` is unchanged and sign-in remains refused per §4.1. The row then shows verified *and* disabled at once, which is the intended independent-columns rendering (FR-005). |

The invariant behind the table: `disabled_at` is written by `UserAdminService` alone
(data-model INV-2 keeps it out of `$fillable`), so no unauthenticated or self-service path
can reach it.

---

## 5. Frontend contract

| Concern | Contract |
|---|---|
| Page URL | `/admin/users`, gated by `<RequireRole role="admin">`; the nav link is shown only to admin+ (FR-003). |
| Paging | `?page=N` in the URL; Back/Forward/Refresh restore exactly that page (FR-007). |
| Row control | Exactly one per row: **Disable** when active, **Enable** when disabled; single click, no confirmation step (FR-009). |
| Row control visibility | Rendered only when `Role.outranks(viewerRole, row.role)`; otherwise a short textual reason replaces it (FR-011 UI half, research D6). |
| After an action | The returned row replaces the old one in place; the admin stays on page N (FR-016). |
| Failed action | The row is left exactly as it was — a non-2xx or network failure never paints a state the server did not confirm. |
| State signalling | Verified and disabled states are conveyed in text, never by colour alone (FR-005/Principle IV); the disabled cell shows the timestamp and the acting account's name. |
| Empty / error | An explicit "no entries" state (FR-017), and a distinct failure + retry state — a failed fetch must never read as "no accounts". |
