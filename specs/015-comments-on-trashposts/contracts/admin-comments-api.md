# Contract: Admin Comment Moderation API

Comment moderation actions, keyed by the comment's own public `hash` (never a DB id,
Principle V). Mounted inside the existing admin group in `routes/api.php`
(`auth:sanctum` + `role:admin`), so every caller is already admin-or-higher — guests get
`401`, members get `403`, without any per-action role code (FR-010, SC-004).

```
POST   /api/admin/comments/{hash}/hide      # visible → hidden
POST   /api/admin/comments/{hash}/unhide    # hidden  → visible
DELETE /api/admin/comments/{hash}           # hard delete (permanent)
```

`{hash}` is the comment's 10-char public code. An unknown hash → **404**.

All three are unsafe mutations: the SPA sends `X-XSRF-TOKEN` (via `Csrf.ensure()`).

---

## POST /api/admin/comments/{hash}/hide

Set `hidden_at = now()` if the comment is currently visible; **idempotent** — an already
hidden comment keeps its original `hidden_at` (set-to-target, converges under concurrent
admin actions, spec edge case "Concurrent moderation").

### 200 response — the updated row

```json
{ "data": { "hash": "Ab3-xY9_q2", "body": "…", "username": "alice", "hidden": true, "created_at": "…" } }
```

The client updates the row in place (marks it hidden) and **decrements** the public count
**only when the row actually transitioned visible → hidden** (FR-014, FR-015: hidden
comments are not counted publicly), without the admin losing their place (FR-014). Because
hide is idempotent, a repeat/concurrent hide of an already-hidden row returns `hidden: true`
but MUST NOT decrement the count a second time — the client adjusts on the observed state
change (prior local `hidden` vs. the response), never unconditionally (edge case
"Concurrent moderation").

---

## POST /api/admin/comments/{hash}/unhide

Set `hidden_at = null` if currently hidden; idempotent for an already visible comment
(FR-012, reversible with no residual effect).

### 200 response — the updated row

```json
{ "data": { "hash": "Ab3-xY9_q2", "body": "…", "username": "alice", "hidden": false, "created_at": "…" } }
```

The client marks the row visible again and **increments** the public count **only when the
row actually transitioned hidden → visible**; an idempotent repeat/concurrent unhide of an
already-visible row returns `hidden: false` but MUST NOT increment the count again (symmetric
with hide above).

---

## DELETE /api/admin/comments/{hash}

Permanently remove the comment row (hard delete — no soft delete, D3). Supersedes the hidden
state: a hidden comment can still be deleted (edge case "Hide then delete"). Irreversible
(FR-013, SC-006) — the SPA confirms first via `useNotice().ask` before calling this.

### 204 response

No body. The client drops the row from the list; if the deleted comment was visible, it
**decrements** the public count (a hidden comment was not in the public count, so deleting it
leaves the count unchanged). Any non-2xx leaves the row untouched (fail-safe, like the
trashpost purge flow).

### Error responses (all three routes)

| Status | When |
|--------|------|
| 401    | Guest (no session). |
| 403    | Authenticated member (below admin). |
| 404    | Unknown comment `{hash}`. |

### Transaction & concurrency

Each transition loads the comment row with `lockForUpdate()` inside a DB transaction and
applies its change only on a real state change (hide/unhide guard on current `hidden_at`), so
two admins acting near-simultaneously converge to a single settled state without error —
mirroring `ModerationService`'s locked `find()` + state-guard pattern.
