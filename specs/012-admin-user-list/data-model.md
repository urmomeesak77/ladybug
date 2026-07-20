# Phase 1 Data Model: Admin User List

**Feature**: 012-admin-user-list | **Date**: 2026-07-20

One table changes (`users`, two new nullable columns). No new table, no new relationship
beyond a self-reference on `users`. See [research.md](./research.md) D1–D2 for why.

---

## 1. `users` — changed

### New columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `disabled_at` | `timestamp` | yes | `null` | Null ⇒ the account is active. Set on disable, cleared on enable. |
| `disabled_by` | `foreignId` → `users.id` | yes | `null` | The account that performed the disable. `nullOnDelete`. Cleared together with `disabled_at`. |

Migration: `2026_07_20_000002_add_disabled_to_users_table.php` (adds both columns and the
FK; `down()` drops the FK then both columns — `MigrationReversibilityTest` covers this).

### Existing columns this feature reads

| Column | Used for |
|---|---|
| `hash` (10 chars, unique) | The **only** public row handle — URLs and action requests (FR-020, research D1). |
| `name` | Row column 1. |
| `email` | Row column 2 — admin-only exposure (FR-018). |
| `role` | Row column 3, and the operand of the strict-rank guard (FR-011). |
| `email_verified_at` | Row column 4 — null ⇒ "not verified". |
| `created_at` | Row column 5 and the sort key. |

### Invariants

- **INV-1** — `disabled_at` and `disabled_by` are written and cleared **together**. An
  active account (`disabled_at IS NULL`) never carries a `disabled_by` (FR-008a).
  `disabled_by` may independently become null on a disabled row only via `nullOnDelete`
  (the "unresolvable actor" edge case).
- **INV-2** — Neither column appears in `User::$fillable`; only `UserAdminService` writes
  them (same guard as `role` and `rating`).
- **INV-3** — `disabled_by` never leaves the backend as an id. `AdminUserResource`
  serializes the actor's `name`, or `null`.
- **INV-4** — Disabling changes nothing else: not `role`, `email`, `email_verified_at`,
  `password`, `rating`, nor any owned `trashposts` row (FR-010/FR-010a, research D9).

### Model additions (`App\Models\User`)

- Cast `disabled_at` → `datetime`.
- `disabledBy(): BelongsTo` — self-reference on `disabled_by`, eager-loaded by the list
  query to avoid an N+1 across 100 rows.
- `isDisabled(): bool` — `$this->disabled_at !== null`. The single readable spelling of
  the state, used by the middleware, the login refusal, and the resource.

---

## 2. State transitions

An account is a two-state machine. Both transitions are **set-to-target, not toggle**, so
repeats and concurrent calls converge (research D10).

```
        disable (actor outranks target)
 active ───────────────────────────────► disabled
   ▲                                        │
   └────────────────────────────────────────┘
         enable (actor outranks target)
```

| Transition | Precondition | Effect | Already in target state |
|---|---|---|---|
| **disable** | actor's role strictly outranks target's role | `disabled_at = now()`, `disabled_by = actor.id` | No-op; original timestamp and actor kept |
| **enable** | actor's role strictly outranks target's role | `disabled_at = null`, `disabled_by = null` | No-op |

Refusals (403, target unchanged): actor does not outrank target — which covers a peer, a
higher rank, **and the actor's own row**, because a role never outranks itself
(research D5).

Both transitions run inside a DB transaction with the target loaded fresh, so the rank
comparison is evaluated against current stored roles at the moment of application
(FR-012).

---

## 3. Read projection — the user-list row

`AdminUserResource` (new). Admin-only; never reachable from a public or member-facing
response (FR-018). Deliberately omits `id`, `disabled_by` (the id), `password`,
`remember_token`, `email_sha1`, and `rating`.

| Field | Type | Meaning |
|---|---|---|
| `hash` | string(10) | Public row handle; the client's React key and action target. |
| `name` | string | Display name. |
| `email` | string | Admin-only. |
| `role` | `"member" \| "admin" \| "superuser"` | Stored role (never `guest`). |
| `email_verified_at` | string \| null | `Y-m-d H:i:s`, null ⇒ never verified. |
| `created_at` | string \| null | `Y-m-d H:i:s`. |
| `disabled_at` | string \| null | `Y-m-d H:i:s`, null ⇒ active. |
| `disabled_by` | string \| null | The acting account's **name**, or null (INV-3, unresolvable actor). |

Datetime formatting matches `AdminTrashpostResource` (`Y-m-d H:i:s`), so the frontend's
existing date-only + full-value-tooltip cell treatment applies unchanged.

### Ordering and paging

`created_at DESC, id DESC`, 100 rows per page (FR-006a), every state included — verified
or not, disabled or not, any role (FR-006). A page beyond the last is an empty page, not
an error.

---

## 4. Frontend types (`lib/userAdminModel.ts`)

`RawUserRow` mirrors the JSON above in snake_case; `UserRow` is the camelCase render
shape (`emailVerifiedAt`, `createdAt`, `disabledAt`, `disabledBy`), exactly the
Raw→mapped split `moderationModel.ts` uses.

Derived, never stored:

- `isDisabled` — `disabledAt !== null`.
- **actionable** — `Role.outranks(viewerRole, row.role)`; decides whether the row shows a
  control or a textual reason (research D6). The server re-checks regardless.
