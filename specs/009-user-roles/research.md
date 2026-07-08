# Phase 0 Research: User Roles (Backbone)

Decisions that resolve the open technical choices before design. No
NEEDS CLARIFICATION remained after the spec's 2026-07-08 clarification (the
role name "member"); the items below are the design choices this backbone makes.

## D1 — Role model: in-house native enum, not a permissions package

**Decision**: Model roles with a native PHP backed enum `App\Enums\Role` and a
mirrored in-house `Role` class on the frontend. Do **not** add
`spatie/laravel-permission` or any RBAC package.

**Rationale**: Principle I (Minimal Dependencies, NON-NEGOTIABLE) makes "no" the
default answer to a new package. This feature is deliberately a *backbone*: a
single scalar column, four values, one strict ordering, and an "outranks"
comparison. A native enum expresses the closed set and the ordering directly,
in one authoritative place (FR-012 / SC-006), with `match`-based methods that
carry no runtime cost and no closures. A permissions package would add a
dependency, migrations for permission/role pivot tables, and a per-resource
permission model that the spec explicitly rules out (OOS-003: one role per
account, no per-resource permissions).

**Alternatives considered**:
- *spatie/laravel-permission* — rejected: heavyweight for one column; pulls in a
  multi-role, per-permission model that contradicts OOS-003 and needs approval.
- *Plain string constants / a `config` array* — rejected: no type safety, invites
  divergent duplicated lists, and can't hang `rank()`/`outranks()` behaviour off
  the value in one place.
- *Database `roles` table with FK* — rejected: over-modelled for a fixed,
  code-defined vocabulary that never changes at runtime; the enum *is* the
  authoritative list.

## D2 — Guest is a modelled-but-never-stored enum case

**Decision**: The enum has all four cases — `Guest`, `Member`, `Admin`,
`Superuser` — but only `Member`, `Admin`, `Superuser` are *assignable* (a
`Role::assignable()` subset). `Guest` exists purely for ordering and for naming
the effective role of an unauthenticated actor; it is never written to a row.

**Rationale**: The ordering guest < member < admin < superuser (FR-002) and the
"outranks a guest" scenarios (US3 scenario 4) need `Guest` to be a first-class,
comparable value. But FR-003 and the spec edge cases forbid storing it on an
account. Keeping guest in the enum (for rank/compare) while excluding it from
the assignable subset (for validation and the DB) satisfies both: one type
answers "what is the effective role?" including the guest case, and a narrow
guard answers "may this be assigned?". The column's default and the model
default are `member`, never `guest`.

**Alternatives considered**:
- *Two enums (StoredRole vs EffectiveRole)* — rejected: duplicates the ordering
  across two types, working against FR-012's single authoritative definition.
- *Nullable role column where NULL means guest* — rejected: FR-003 says every
  account has a role; guest describes "no account", not "an account with no
  role". NULL on an account would be the invalid/missing-role data error the
  spec says must be impossible.

## D3 — Storage: plain string column, app-enforced closed set (no MySQL ENUM)

**Decision**: Migration adds `role` as `string`, `NOT NULL`, `DEFAULT 'member'`.
The closed set is enforced by the Eloquent enum cast plus validation, not by a
MySQL `ENUM` column type or a DB `CHECK` constraint.

**Rationale**: Tests run exclusively on SQLite `:memory:` (project invariant),
while production is MySQL. A plain `string` column behaves identically on both
drivers, whereas MySQL `ENUM` and cross-driver `CHECK` syntax diverge and would
force driver branching in the migration (the existing users migration already
branches only for a MySQL-only collation — adding more is avoidable). Casting
the column to `Role::class` makes reads return an enum and makes an out-of-set
stored value throw (`ValueError`) rather than silently downgrade — exactly the
"treated as a data error" behaviour the spec's edge cases require. Writes go
through Eloquent (parameterized), never string-concatenated SQL (Principle VI).

**Alternatives considered**:
- *MySQL native `ENUM('member','admin','superuser')`* — rejected: not portable
  to the SQLite test driver; schema drift between test and prod.
- *DB `CHECK` constraint* — rejected as belt-and-suspenders: the enum cast +
  non-fillable column + validation already prevent out-of-set writes through the
  only supported path (Eloquent), and CHECK syntax/support differs by driver.

## D4 — New-row default AND legacy backfill via the column default

**Decision**: The single `DEFAULT 'member'` on the new column supplies both
FR-004 (new registrations default to member) and FR-010 (pre-existing accounts
backfilled to member). The `User` model also sets a default attribute
`role => 'member'` so freshly-built (not-yet-saved) instances already read as
member.

**Rationale**: Adding a `NOT NULL DEFAULT 'member'` column rewrites existing rows
with the default in the same DDL — no separate data-migration pass, no risk of a
row missing a role between deploy steps (SC-001: zero accounts without a valid
role). The model-level default attribute closes the gap for the register
response, which serialises the user immediately after `save()`: with the default
attribute the in-memory instance reports `member` without a reload. `UserService`
therefore needs no change — it keeps not setting role, and the default owns
FR-004.

**Alternatives considered**:
- *Set role explicitly in `UserService::create`* — rejected as redundant once the
  model/DB default exists; would also leave `factory()`/other creation paths
  needing their own explicit assignment. The default centralises FR-004.
- *Separate backfill migration/command* — rejected: unnecessary given the column
  default already rewrites legacy rows; more moving parts, same result.

## D5 — Role is not mass-assignable; first superuser via operator CLI

**Decision**: `role` is kept out of `User::$fillable`. The only supported way to
raise an account above `member` is the operator-run artisan command
`user:make-superuser {email}`; there is no HTTP route that sets a role.

**Rationale**: Mass-assigning role would let a crafted register/account payload
set `role: superuser` — a privilege-escalation hole (Principle VI). Excluding it
from `$fillable` means `create($request->validated())` can never touch it. FR-009
wants the first superuser establishable *without* a pre-existing privileged
account and *not* reachable as an ordinary in-app request: a console command is
exactly that — it runs in the operator's shell (or CI/seed context), keys off the
account's email (not a DB id — respects the "no DB ids as handles" rule), and is
invisible to the HTTP surface. The command uses `Role::Superuser` and validates
the target exists, mirroring `SeedMediaCommand`'s thin-handler shape. Promotion
/ demotion of *other* accounts through the UI stays out of scope (OOS-002).

**Alternatives considered**:
- *An admin API endpoint to set roles* — rejected: that is the deferred
  privilege-gated action (OOS-002), and no in-app actor is yet authorised to
  grant roles; an endpoint now would be an unguarded escalation path.
- *A database seeder only* — rejected as the sole mechanism: a seeder is fine for
  fresh installs but awkward for promoting a chosen existing account by email on
  a running system; a named command is the clearer operator affordance. (A
  seeder may still call the same code later; out of scope here.)
- *A generic `user:set-role {email} {role}`* — deferred: a fully general
  role-setter edges toward the OOS-002 promotion tooling. Scope is *the first
  superuser*, so the command is superuser-focused; generality can come with the
  feature that needs it.

## D6 — No new e2e; correctness lives in unit/feature tests

**Decision**: Add no Playwright spec. Cover the backbone with backend unit/feature
tests and frontend Vitest, including an exhaustive 16-pair "outranks" matrix on
both stacks (SC-004).

**Rationale**: This slice changes no user-visible behaviour — a guest sees the
same site, a logged-in user sees the same UI; role is exposed on the payload but
nothing is yet gated on it (OOS-001). Playwright verifies *flows through the
browser*, and there is no new flow. The existing e2e suite already exercises
register/login/account unchanged. The role model's real risk surface — ordering
correctness, the assignable guard, non-mass-assignability, the register default,
and the bootstrap command — is precisely what unit/feature tests assert directly
and cheaply. The 90% gate on both stacks is met by mirrored tests on every
touched module. When a later feature attaches a privilege to a role (a gated menu
entry, a moderation action), that feature's plan adds the e2e for the behaviour
it introduces.

**Alternatives considered**:
- *A smoke e2e asserting the `role` field appears in the network payload* —
  rejected: it would assert an implementation detail with no user-visible effect,
  duplicating the `authApi`/resource tests at far higher cost and flakiness.
