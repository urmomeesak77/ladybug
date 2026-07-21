# Phase 0 Research: Admin User List

**Feature**: 012-admin-user-list | **Date**: 2026-07-20

Every open question from the Technical Context is resolved below. Nothing here adds a
dependency (Principle I) — the feature is built entirely from the existing Laravel /
Sanctum / React / React Router baseline and the patterns 009–011 already established.

---

## D1 — Public handle for a user row

**Decision**: Use the existing `users.hash` column (10 chars, unique, `utf8mb4_bin` on
MySQL) as the row identifier in URLs and action requests. No new identifier column.

**Rationale**: FR-020 demands a non-enumerable public handle rather than the
auto-increment id. `users.hash` already exists — it was created in
`0001_01_01_000000_create_users_table.php`, is minted by `UserService::persist()` via
`Str::createUniqueHash(10)`, is backfilled by `UserFactory`, and is already the only
account identifier `UserResource` exposes. Reusing it satisfies Principle V's format,
Principle VI's "no ids in URLs", and the project memory rule "never put database ids in
user-facing URLs/links".

**Alternatives considered**:

- *`users.email_sha1`* — exists and is indexed, but it is derived from the e-mail, so it
  changes if the address changes and it leaks a guessable digest of a known address. It is
  purpose-built for session-free verification-link resolution (008 D3), not for general
  addressing. Rejected.
- *A new `public_code` column* — pure duplication of `hash`. Rejected.

---

## D2 — Where the disabled state lives

**Decision**: Two nullable columns on `users`, added in one migration:
`disabled_at` (nullable timestamp, default null) and `disabled_by` (nullable
`foreignId` → `users.id`, `nullOnDelete`). Both are written together and cleared
together. Neither is added to `$fillable`.

**Rationale**: FR-008/FR-008a ask for a point-in-time value plus an actor reference, with
no full history (clarified: no audit-log table). A nullable timestamp is the same shape
`email_verified_at`, `activated_at`, and `deleted_at` already use in this codebase, so
"null means active" needs no explanation. `nullOnDelete` is what produces the spec's
"unresolvable actor" edge case cleanly: if the acting account is ever removed, the
reference goes null and the row degrades to showing the timestamp alone rather than
breaking. Keeping both out of `$fillable` mirrors the `role` and `rating` guards — no
request body can ever reach them (Principle VI, privilege escalation).

`disabled_by` stores a DB id, which is correct precisely because it is **never
serialized**: `AdminUserResource` exposes the actor's *name* (a string) or null, never
the id. This is the same discipline `Trashpost.user_id` follows.

**Alternatives considered**:

- *A boolean `is_disabled` column* — cannot answer "when", which FR-005 requires on the
  row. Rejected.
- *A separate `user_disables` audit table* — explicitly ruled out by the 2026-07-20
  clarification ("no separate full-history audit log"). Rejected as unrequested schema.
- *Storing the actor's `hash` instead of the id* — no referential integrity, and it would
  not null out when the actor is removed, reopening the stale-reference edge case.
  Rejected.

---

## D3 — Killing live sessions of a newly disabled account (FR-014)

**Decision**: A new `App\Http\Middleware\EnsureAccountEnabled`, appended to the **api**
middleware group in `bootstrap/app.php` (after `statefulApi()`). When the resolved user
carries a non-null `disabled_at`, it logs the `web` guard out, invalidates the session,
regenerates the CSRF token, and returns `401 {"message": "This account is disabled."}`.
When no user is resolved, or the user is active, it is a pass-through.

**Rationale**: The requirement is "stops granting access from its next request onward" —
that is a per-request check, and the only place it holds for *every* authenticated route
without being forgotten on the next one is the group-level middleware. Sanctum's
`EnsureFrontendRequestsAreStateful` (installed by `statefulApi()`) prepends the web
middleware group, so the session is started and `$request->user()` resolves by the time
this middleware runs.

401 is the right code (the *session* is no longer valid), and it costs the SPA nothing:
`AuthApi.fetchCurrentUser` already maps a non-ok response to `null`, so a disabled user's
next `/api/user` probe reads as anonymous and the SPA drops to the logged-out UI without
any new client code. Invalidating the session on the way out means the dead cookie cannot
be replayed.

**Consequence for `POST /api/logout`**: the middleware sits in the api group, so a disabled
user's logout is answered `401` before `AuthController::logout` runs. This is intentional and
not a regression — the middleware has already logged the `web` guard out, invalidated the
session and rotated the CSRF token, so the logout's own work is done by the time the response
is written. The SPA needs nothing: `AuthApi.fetchCurrentUser` maps any non-ok probe to `null`,
so the UI drops to the logged-out state either way. The alternative — exempting `/logout` from
the group — was rejected: an exemption list is exactly how a route later gets forgotten, and
FR-014 says *every* request from the next one onward.

**Alternatives considered**:

- *Custom user provider whose `retrieveById` returns null for disabled accounts* — hides
  a security-critical rule inside auth plumbing where no reader would look for it, and is
  awkward to test. Rejected.
- *Checking `disabled_at` inside each controller* — one forgotten controller is a hole,
  and the check would have to be repeated on every future route. Rejected.
- *Laravel's `AuthenticateSession` + password-hash rotation* — invalidates sessions as a
  side effect of changing the password hash. Mutating credentials to revoke access is a
  lie in the data model, and FR-015 requires re-enable to restore sign-in with the
  *existing* credentials. Rejected.

---

## D4 — Refusing sign-in for a disabled account (FR-013)

**Decision**: In `AuthController::login`, keep `Auth::attempt()` **first**; only if it
succeeds, check `disabled_at`. If disabled, log the just-established session out and
return `403 {"message": "This account is disabled."}` — distinct from the existing
generic 401 credential message.

**Rationale**: Order matters for security. Checking `disabled_at` *before* verifying the
password would turn the login form into an oracle: anyone could type an address and learn
whether that account exists and is disabled. Verifying credentials first means only the
account's actual owner ever sees the disabled message, which is exactly who FR-013 wants
to inform. The distinct status code (403 = authenticated but forbidden) lets the SPA tell
the two failures apart without string matching.

**Alternatives considered**:

- *Reuse the generic 401 credential message* — violates FR-013's "distinct from a
  wrong-credentials message"; the user would waste time on password resets. Rejected.
- *Add `disabled_at IS NULL` to the `Auth::attempt` credential array* — silently produces
  the wrong-credentials message, same violation. Rejected.

---

## D5 — Enforcing the strict-rank rule (FR-011/FR-012)

**Decision**: Server-side in `UserAdminService`, using the existing
`Role::outranks()`: the action proceeds only when `$actor->role->outranks($target->role)`,
evaluated inside the transaction against freshly loaded rows. Anything else aborts 403 and
leaves the target untouched. The actor comes from `$request->user()`, never from the body
(FR-008b).

**Rationale**: `Role::outranks()` is already strict (`rank() > rank()`, equal ⇒ false),
which delivers all four US4 cases for free: admin-vs-admin, admin-vs-superuser,
superuser-vs-superuser, and — because an account always ties with itself — the self-lockout
guard, with no special-case `id !== id` branch. Loading the target inside the transaction
is what makes the "role change mid-view" edge case correct: the comparison runs on current
stored data, not on what the client rendered.

**Alternatives considered**:

- *A Laravel Policy (`UserPolicy::disable`)* — idiomatic, but the project has no policies
  yet and the rule is one line; introducing a whole authorization layer for it is
  complexity the constitution asks us not to add. The service check is equally
  enforceable and sits next to the transaction it guards. Rejected for now.
- *Client-supplied actor role* — Principle VI violation, explicitly barred by FR-008b/FR-012.
  Rejected.

---

## D6 — How the UI decides which rows offer a control

**Decision**: Derive it client-side from data already present:
`Role.outranks(viewerRole, row.role)`, with the viewer's role from `useAuth()`. No
`can_disable` field is added to the payload. Rows that fail the check render a short
textual reason instead of a button.

**Rationale**: `lib/role.ts` exists precisely as the frontend mirror of the backend enum
(established by 009), and `RequireRole` already sets the precedent of mirroring a server
boundary in the SPA for UX while the server stays the authority. Because `outranks` is
strict, the viewer's own row, peers, and higher ranks all lose the control automatically.
The server re-checks every request (D5), so a tampered client gains nothing.

**Alternatives considered**:

- *Server-computed `can_disable` per row* — one more field to keep in sync, and it would
  still need the server-side re-check at action time, so it buys no safety. Rejected.

---

## D7 — Pagination

**Decision**: Laravel `paginate(100, ['*'], 'page', $page)` ordered
`created_at DESC, id DESC`, with `disabledBy` eager-loaded. The SPA reads `?page=N` from
the URL, exactly as `useModeration` does.

**Rationale**: FR-006a/FR-007 ask for 100 rows per page with the page in the URL, "matching
the existing meme-moderation table" (clarified). `ModerationService::paginate` is that
table; copying its shape — including the `id` tiebreak that keeps same-instant rows
deterministically ordered across pages — gives identical, already-proven paging
semantics, and Laravel's paginator returns an empty page (not an error) beyond the last
page, which is the spec's out-of-range edge case. Eager-loading `disabledBy` avoids an
N+1 across 100 rows.

**Alternatives considered**:

- *Keyset pagination (the public feed's approach)* — the feed uses it for infinite scroll;
  a back-office table needs numbered page links, which keyset cannot provide. Rejected.

---

## D8 — Sharing the page-link machinery with the moderation table

**Decision**: Extract the page-link math and the numbered-links component into shared
admin pieces — `lib/adminPaging.ts` (class `AdminPaging`: `PageMeta` type, `pageLinks`,
`parsePage`) and `components/admin/AdminPagination.tsx` (props `meta` + `label`).
`ModerationModel.pageLinks`/`parsePage` become thin delegations to `AdminPaging`, and
`ModerationPagination` becomes a thin wrapper over `AdminPagination`.

**Rationale**: The user list needs byte-identical paging behavior to the moderation table.
Copying ~40 lines of page-link math and markup into a parallel `UserPagination` would be
duplication the conventions warn against. Keeping the 010 names as delegating wrappers
means every existing 010 test and import keeps working — the refactor is additive, so it
cannot destabilize a shipped feature while 012 is in flight.

**Alternatives considered**:

- *Duplicate the component under `components/users/`* — cheap now, two places to fix
  later. Rejected.
- *Rename `ModerationPagination` → `AdminPagination` outright and update 010* — cleaner
  end state, but it edits shipped 010 components and their tests as collateral of an
  unrelated feature. Rejected in favour of the additive path.

---

## D9 — Not touching content or rating (FR-010a)

**Decision**: `disable`/`enable` write only `disabled_at` and `disabled_by`. They do not
call `MediaVisibilityService`, `ModerationService`, or `RatingService`, and no meme query
anywhere gains a `disabled_at` condition.

**Rationale**: The 2026-07-20 clarification is explicit — disabling is access revocation
only; the account's memes stay live and keep accruing rating, and takedown remains the
moderation console's job. This is a decision to write *down* rather than to implement:
the risk here is a well-meaning "surely we should also hide their posts", which would
silently change 010/011 behavior. Recorded so review can catch it.

---

## D10 — Route and page naming

**Decision**: API `GET /api/admin/users`, `POST /api/admin/users/{hash}/disable`,
`POST /api/admin/users/{hash}/enable`, mounted in the existing
`auth:sanctum` + `role:admin` group in `routes/api.php`. SPA page at `/admin/users`,
gated by `<RequireRole role="admin">`.

**Rationale**: The `admin/` prefix group already carries exactly the gate FR-002 requires,
so the new routes inherit the guest→401 / member→403 / admin→through boundary with no new
middleware. `POST` for both transitions matches the moderation console's
activate/deactivate pair; both are set-to-target, so both are idempotent (the
concurrent-action edge case resolves without error). The SPA path mirrors
`/admin/trashposts`.

**Alternatives considered**:

- *A single `POST /api/admin/users/{hash}/toggle`* — a toggle's outcome depends on the
  state the client last saw, so two admins acting at once flip each other's work. The
  spec's concurrency edge case requires convergence. Rejected.
