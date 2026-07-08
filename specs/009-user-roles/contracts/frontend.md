# Contract: Frontend Role Helper & Auth Context

**Feature**: 009-user-roles

No new routes, pages, or visible UI. This slice adds the role *vocabulary* and
makes the current viewer's effective role readable from the auth context, so
future features can branch on it (OOS-001 keeps the actual gating out of scope).

## `lib/role.ts` — mirror of the backend enum (FR-012)

A `static`-method class (class-over-function rule) holding the same set, order,
and comparison as `App\Enums\Role`. Methods use `switch`/lookup, no closures.

```ts
export type RoleName = 'guest' | 'member' | 'admin' | 'superuser';

export class Role {
  // Strict low→high order; index is the rank.
  static readonly ORDER: readonly RoleName[]; // ['guest','member','admin','superuser']

  static rank(role: RoleName): number;              // 0..3
  static outranks(a: RoleName, b: RoleName): boolean; // rank(a) > rank(b); equal ⇒ false
  static isAssignable(role: RoleName): boolean;     // true for member/admin/superuser, false for guest
}
```

**Guarantees**: the 16-pair `outranks` matrix matches
[data-model.md](./data-model.md) exactly (SC-004); `isAssignable('guest')` is
`false`. Asserted exhaustively in `tests/lib/role.test.ts`.

## `lib/authApi.ts` — role on the user (FR-007)

```ts
// AuthUser gains:
role: RoleName;             // from data.role ("member" | "admin" | "superuser")

// RawUser gains role: RoleName; AuthApi.mapUser copies it through:
//   role: raw.role
```

The API only ever sends an assignable value on a user; `guest` is never a stored
user's role. Mapping is a straight pass-through (mirrored in `authApi.test.ts`).

## `hooks/useAuth.ts` + `components/AuthProvider.tsx` — effective role (FR-006)

The context exposes the **current viewer's effective role**, so any consumer can
ask "what am I?" and get `guest` when logged out (US2):

```ts
// AuthContextValue gains:
role: RoleName;   // user ? user.role : 'guest'
```

- `AuthProvider` derives `role` from the current `user` (`user?.role ?? 'guest'`)
  and includes it in the memoised context value alongside `status`/`user`.
- While `status === 'unknown'` (initial probe in flight) the derived role is
  `guest` (no user yet); it updates to the stored role once the probe resolves,
  exactly like `status`.
- No component *consumes* `role` yet — wiring it to menus/guards is the deferred
  privilege-gated work (OOS-001). This contract only guarantees the value is
  present and correct.

**Mirrored test** (`tests/components/AuthProvider.test.tsx`): anonymous ⇒
context `role === 'guest'`; authenticated as each stored role ⇒ context `role`
equals the user's role.

## Out of scope (named for clarity)

- No `RequireRole` guard, no role-gated menu entries, no promotion/demotion UI
  (OOS-001, OOS-002). Those arrive with the features that need them.
