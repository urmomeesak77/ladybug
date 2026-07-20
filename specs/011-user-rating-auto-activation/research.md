# Phase 0 Research: User Rating & Auto-Activation

All Technical Context unknowns are resolved below. No NEEDS CLARIFICATION remains.

## D0 — The spec's "upload does not yet exist" dependency is stale

**Decision**: Treat FR-015 … FR-020 as **implementable and testable now**, not as a contract
handed to a future feature.

**Finding**: The spec's Dependencies section states "There is currently no upload path in the
system." That was true when the spec was drafted against the feature list, but feature 008
landed an upload slice that is live on `master`:

- `POST /api/posts` → `TrashpostsApiController::store` (`backend/routes/api.php:24`), behind
  `auth:sanctum` + `verified` + `throttle:uploads`.
- `TrashpostService::createPost()` (`backend/app/Services/TrashpostService.php:64`).
- Frontend `UploadPage.tsx`, `lib/uploadApi.ts`, `lib/uploadModel.ts`, `hooks/useUploadForm.ts`.

**Consequence**: this feature is a single deliverable, not a split one. `createPost()` today
**unconditionally activates** every upload — YouTube posts activate in `reserve()`
(`TrashpostService.php:96`), image posts in `attachImage()` (`TrashpostService.php:121`). FR-018
makes that conditional, which is a behaviour change to shipped code, not new construction.

**Rationale**: verified by reading the current source rather than trusting the spec prose. The
spec's own note that FR-001 … FR-014 are "fully implementable today" is right; the FR-015 …
FR-020 caveat is simply out of date.

**Alternatives considered**: defer the auto-activation half to the upload feature — rejected,
there is nothing left to defer it to.

## D1 — Where the per-meme rating bookkeeping lives

**Decision**: Two boolean columns on `trashposts` — `rating_credited` and `rating_penalized`.
No ledger table.

**Rationale**: The spec's Key Entities section says the bookkeeping "must survive the meme being
hard-deleted, since the row is gone but the rating effect is permanent." Read operationally,
that requirement is already met by columns on the row: the rating effect lives on
`users.rating`, which is written **before** the row disappears. Once purged, the hash 404s
(`ModerationService::find()` uses `firstOrFail()`), so no later operation can target that meme
and no flag is ever needed again. What must survive is the *effect*, not the *bookkeeping* —
and the effect lives on the user row.

The two flags make every adjustment self-idempotent, which is what FR-006, FR-008 and FR-014
actually demand:

| Flag | Meaning | Set by | Cleared by |
|------|---------|--------|-----------|
| `rating_credited` | this meme is currently holding a +1 for its owner | activate, auto-activate | deactivate, purge |
| `rating_penalized` | this meme has already cost its owner its one −1 | soft delete, purge | restore |

Every adjustment is conditional on the flag actually changing, so a repeated activate, a
double delete, or a soft-then-hard delete each move the rating exactly once (FR-008, FR-014).

**Alternatives considered**:

- **A `rating_events` ledger table** (one row per adjustment). Rejected: it buys an audit
  trail and back-computation, and FR-002 explicitly forbids back-computation while FR-003
  forbids any manual override — so there is no surface that would ever read the history. A
  whole table, migration, model, and join for zero requirement is a Principle I violation in
  spirit even though it adds no package.
- **Derive the rating on read** (`COUNT(activated and not deleted) − COUNT(deleted)`).
  Rejected on two counts: purged rows are gone, so the deletion term is unrecoverable; and
  FR-002 mandates a 0 baseline that a derived count would contradict for every pre-existing
  activated meme.
- **Eloquent observers on `Trashpost`**. Rejected: hidden global state, and Principle VII
  demands code "written to be testable: … separation of concerns over hidden global state."
  Explicit service calls are also the only way to express the purge case, where two
  adjustments must land inside one transaction with the row deletion.

## D2 — Atomicity, saturation, and concurrency

**Decision**: One `DB::transaction()` per moderation action, taking `lockForUpdate()` on the
**post row first, then the user row**, and clamping the new rating in PHP.

**Rationale**:

- **FR-013 (all-or-nothing)**: wrapping the state change and the rating write in one
  transaction is the only way the meme's state and its owner's rating cannot disagree.
- **FR-014 (no double count)**: the flags alone are not enough under true concurrency — two
  simultaneous activates could both read `rating_credited = false`. `lockForUpdate()` on the
  post row serializes them, so the second sees the flag already set and adjusts nothing.
- **FR-011a (saturate)**: rules out a bare `increment()`/`decrement()`, which would wrap or
  error at the smallint bounds. The rating must be read under lock, clamped with
  `max(MIN, min(MAX, current + delta))`, and written back.
- **Deadlock avoidance**: a fixed lock order (post → user) across every action means two
  moderators acting on two memes owned by the same user cannot deadlock.

**Alternatives considered**:

- **Atomic SQL `increment()`** — lock-free and concurrency-safe, but cannot saturate (FR-011a)
  and cannot read-check the flag in the same statement.
- **Optimistic retry on a version column** — extra column and retry loop to solve a
  contention problem that does not exist at this scale (moderation is a handful of admins
  clicking buttons).

## D3 — Column type and guards on `users.rating`

**Decision**: `$table->smallInteger('rating')->default(0)->after('role');` — signed, NOT NULL.

**Rationale**: The feature description says smallint. Signed (not `unsignedSmallInteger`) is
forced by FR-011: ratings may go negative. Range is **−32768 … 32767**, and those are the
saturation bounds FR-011a refers to. `default(0)` both pins new accounts (FR-001) and backfills
every existing account in one DDL step (FR-002) — the exact pattern
`2026_07_08_000001_add_role_to_users_table.php` used for `role`.

`rating` is deliberately **absent from `User::$fillable`**, mirroring the comment already on
`role` in `User.php:33-40`: no request body can reach it through `fill()`. That is FR-003's
"MUST NOT be settable directly by any request, from any actor or role" enforced structurally
rather than by a validation rule that a future controller could forget.

`rating` is **not** added to `UserResource`, satisfying FR-022 (never in public meme/feed data
— and `GET /api/user` returns the caller's own account, which FR-022 also keeps clean).

## D4 — Auto-activation leaves pending media on the public disk (security)

**Decision**: `createPost()` MUST call `MediaVisibilityService::sync()` whenever the upload is
**not** auto-activated.

**Rationale**: This is the sharpest finding of the research and it is a genuine security
consequence, not a detail. `TrashpostImageProcessor::process()` writes every size variant to
the **`public` disk** (`TrashpostImageProcessor.php:31,55,82`). Today that is harmless because
`createPost()` activates everything. Once FR-018 leaves sub-threshold uploads unactivated, the
row is hidden from the JSON API while the bytes stay URL-addressable on the public disk —
precisely the bypass `MediaVisibilityService` was introduced to close ("hiding the JSON while
still serving the bytes would let saved permalinks bypass moderation",
`MediaVisibilityService.php:12-18`).

`sync()` is already state-driven (`public` ⇔ activated and not trashed) and idempotent, so the
fix is to call it on the create path for the pending case. YouTube uploads need it too: the
thumbnail is fetched to the public disk by `YoutubeThumbnailService::ensure()`.

**Alternatives considered**: write to the private disk first and promote on activation —
cleaner in the abstract, but it reworks the whole 008 image pipeline and its tests to solve a
problem `sync()` already solves in one call.

## D5 — Threshold and role check placement

**Decision**: A new `App\Services\RatingService` owns both the adjustments and the
`shouldAutoActivate(User): bool` predicate, with `TRUST_THRESHOLD = 15` as a class constant.

**Rationale**: One class, one concept — the rating. `ModerationService` calls it for the five
state transitions; `TrashpostService::createPost()` calls it for the upload decision. Keeping
the threshold beside the adjustments means the rule and the number it is compared against
cannot drift apart. Per `docs/CODING_CONVENTIONS.md` v1.3 and CLAUDE.md, backend logic lives in
a service class, injected via the existing constructor-default pattern
(`ModerationService.php:25`) so tests can substitute it.

The role half of FR-017 reads the existing `Role` enum: `!Role::Admin->outranks($user->role)`
is true for admin and superuser and false for member — reusing the shipped comparison rather
than a new one. FR-020's "rating as it stands before the new upload's own credit" falls out
naturally: `shouldAutoActivate()` is called before the post is created.

## D6 — Rating on the moderation table

**Decision**: `AdminTrashpostResource` gains `'rating' => $this->user?->rating` (null for an
unowned meme); the frontend renders a literal **"no account"** for null.

**Rationale**: FR-021 requires the owner's rating on each row and requires unowned memes to
render "an explicit 'no account' indication rather than a numeric rating or a blank cell". A
`null` in the JSON plus explicit text in the cell satisfies both. `ModerationService::paginate()`
already eager-loads `with('user')` (`ModerationService.php:37`), so no N+1 is introduced.

Text (not a colour or an icon alone) also satisfies Principle IV: colour is never the sole
means of conveying information.
