# Phase 1 Data Model: User Roles (Backbone)

## Entity: Role (code-defined vocabulary, not a table)

A fixed, closed, strictly-ordered set of privilege levels. It is defined **once
per stack** (FR-012 / SC-006): `App\Enums\Role` (backend, authoritative) and
`lib/role.ts` (frontend, mirror). It is *not* a database table (research D1).

| Case / name | String value | Rank | Assignable to an account? | Meaning |
|-------------|--------------|------|---------------------------|---------|
| `Guest`     | `guest`      | 0    | **No** (implicit only)    | Unauthenticated actor — no account/session. |
| `Member`    | `member`     | 1    | Yes (**default**)         | Standard logged-in user. |
| `Admin`     | `admin`      | 2    | Yes                       | Moderator; outranks members. |
| `Superuser` | `superuser`  | 3    | Yes                       | Unrestricted; outranks everyone. |

### Ordering & operations (FR-002, FR-008)

Strict total order by rank: `guest < member < admin < superuser`.

- **`rank(role) → int`** — 0..3 per the table.
- **`outranks(a, b) → bool`** — `rank(a) > rank(b)`. Equal ranks return `false`
  (a role does not outrank itself — spec edge case "equal ranks"; SC-004).
- **`assignable() → {member, admin, superuser}`** — the values a row may hold;
  excludes `guest` (research D2). Used by validation and the bootstrap command.
- **effective role of an actor** = the account's stored role when authenticated,
  else `Guest` (FR-006). Computed where the actor is known (frontend auth
  context; a future backend guard as `$user?->role ?? Role::Guest`), not stored.

### Full "outranks" matrix (SC-004 — all 16 ordered pairs; ✓ = row outranks column)

| outranks? | guest | member | admin | superuser |
|-----------|:-----:|:------:|:-----:|:---------:|
| **guest**     | ✗ | ✗ | ✗ | ✗ |
| **member**    | ✓ | ✗ | ✗ | ✗ |
| **admin**     | ✓ | ✓ | ✗ | ✗ |
| **superuser** | ✓ | ✓ | ✓ | ✗ |

Both stacks assert this exact matrix in tests.

## Entity: Account (User) — extended

The existing `users` row gains exactly one field. All other attributes are
unchanged by this feature.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `role` | string | `NOT NULL`, `DEFAULT 'member'`, value ∈ {member, admin, superuser} | New. Cast to `Role` on the model. Excluded from `$fillable` (not mass-assignable — Principle VI, research D5). |

**Migration** (`add_role_to_users_table`, additive): `string('role')` after
`password`, `->default('member')`, `NOT NULL`. The default rewrites every
existing row to `member` (FR-010) and defaults new inserts (FR-004) in one DDL —
no separate backfill (research D4). Reversible `down()` drops the column.

**Model (`User`)**:
- `casts()`: `'role' => Role::class` — reads return a `Role`; an out-of-set stored
  value throws rather than silently downgrading (spec edge case, research D3).
- default attribute `role => Role::Member->value` so a freshly built instance
  already reads `member` (covers the register response before reload, research D4).
- `role` stays **out of `$fillable`** (privilege-escalation guard).

**Factory (`UserFactory`)**: default `role => Role::Member->value`; helper states
`admin()` and `superuser()` for tests. `unverified()` (008) is orthogonal —
role is independent of verification (FR-011).

### Validation & state rules

- **FR-003 / FR-005**: a row holds exactly one value from the assignable set; any
  attempt to set an out-of-set value is rejected. Through Eloquent this is
  enforced by the enum cast (invalid value ⇒ error, never a silent valid value);
  the assignable guard is available for any future endpoint that sets a role.
- **FR-004**: new accounts default to `member` (model/DB default).
- **FR-010**: pre-existing accounts backfilled to `member` (column default).
- **FR-011**: role is independent of `email_verified_at` and of owned `posts`.
- **No state machine**: this backbone defines no role *transitions* beyond the
  one-way operator bootstrap (research D5); promotion/demotion flows are OOS-002.

## Exposure (FR-007)

`UserResource` gains `'role' => $this->role->value`, so every place the account is
serialised — `GET /api/user`, register (201), login (200) — carries the role. The
anonymous `/api/user` response stays `{data: null}`; the client maps that absence
to the effective role `guest` (FR-006). No new endpoint. Details in
[contracts/role.md](./contracts/role.md) and [contracts/frontend.md](./contracts/frontend.md).
