# Contract: Backend Role Model, Payload & Console

**Feature**: 009-user-roles

## `App\Enums\Role` — the authoritative role definition (FR-012)

Native backed enum; the single source of truth for the set, ordering, and
comparison on the backend. Methods are small `match` expressions (no closures).

```php
enum Role: string
{
    case Guest = 'guest';
    case Member = 'member';
    case Admin = 'admin';
    case Superuser = 'superuser';

    public function rank(): int;                 // Guest 0, Member 1, Admin 2, Superuser 3

    public function outranks(self $other): bool;  // rank() > $other->rank(); equal ⇒ false

    /** Values assignable to an account — excludes Guest (member/admin/superuser). */
    public static function assignable(): array;   // list<self>

    /** Parse an assignable value or null (rejects 'guest' and anything out-of-set). */
    public static function tryFromAssignable(string $value): ?self;
}
```

**Guarantees**
- `outranks` realises the strict order guest < member < admin < superuser (FR-002,
  FR-008); equal roles do **not** outrank each other (SC-004).
- `assignable()` never contains `Guest` (research D2), so it drives validation and
  the bootstrap without ever allowing guest onto a row (FR-003).
- `tryFromAssignable('guest' | unknown)` ⇒ `null`; `tryFromAssignable('admin')` ⇒
  `Role::Admin` — the guard for FR-005 wherever a role value must be accepted.

## User payload — added field (FR-007)

`UserResource` gains one field. No response is otherwise reshaped.

```jsonc
// GET /api/user (authenticated), POST /api/register (201), POST /api/login (200)
{
  "data": {
    "id": 1,
    "name": "Ada",
    "email": "ada@example.com",
    "email_verified_at": null,
    "role": "member",            // NEW — one of "member" | "admin" | "superuser"
    "created_at": "…",
    "updated_at": "…"
  }
}
```

- **Anonymous** `GET /api/user` is unchanged: `{ "data": null }` (200). The client
  maps this absence to the effective role `guest` (FR-006) — the backend does not
  emit a `guest` role for a null user.
- A newly registered account's payload always shows `"role": "member"` (FR-004,
  SC-002).
- `role` is **read-only** over the API: it is not in `$fillable`, so no request
  body (register, login, or any future account update) can set or change it
  (Principle VI, research D5). There is **no** HTTP endpoint that writes a role in
  this feature (OOS-002).

## Console command — first-superuser bootstrap (FR-009)

```
php artisan user:make-superuser {email}
```

Operator-only mechanism to establish the initial superuser without a pre-existing
privileged account. **Not** an HTTP route — unreachable as an ordinary in-app
request (FR-009 scenario 2).

| Aspect | Behaviour |
|--------|-----------|
| Target lookup | Finds the account by **email** (not a DB id — respects the no-ids-as-handles rule). |
| Success | Sets the account's `role` to `Role::Superuser`, persists, prints confirmation, exit `0` (`SUCCESS`). Account now reports `superuser` (SC-005). |
| Unknown email | Prints an error, changes nothing, exit non-zero (`FAILURE`). |
| Already superuser | Idempotent: reports the account is already a superuser, exit `0`, no spurious change. |

Run via the project's Dockerised PHP (no local PHP): e.g.
`docker compose exec backend php artisan user:make-superuser ada@example.com`.

## Enforcement summary

| Rule | Where enforced |
|------|----------------|
| FR-003 exactly one assignable role | `NOT NULL` column + enum cast + non-`guest` `assignable()` |
| FR-004 new default = member | model default attribute + column `DEFAULT 'member'` |
| FR-005 reject out-of-set | enum cast (invalid ⇒ error) + `tryFromAssignable` guard for any writer |
| FR-007 role on payload | `UserResource.role` |
| FR-009 operator bootstrap only | `user:make-superuser` command; no route; `role` non-fillable |
| FR-010 backfill legacy rows | column `DEFAULT 'member'` applied by the additive migration |
