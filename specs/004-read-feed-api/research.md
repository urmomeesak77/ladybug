# Phase 0 Research: Read-Side Feed API

All Technical Context items were resolved from the existing codebase, the prototype,
and the constitution — no open `NEEDS CLARIFICATION` remained. This file records the
decisions and why they were taken.

## R1 — Pagination strategy: cursor (keyset) vs offset

- **Decision**: Cursor (keyset) pagination. The feed accepts an optional `start`
  query parameter equal to the **public `hash`** of the last post the client already
  has; results are the next posts strictly older than that one.
- **Rationale**: The prototype uses exactly this (`TrashpostService::getBuilderByFilters`
  with `start`). Keyset paging is stable for an endless, append-heavy feed — newly
  inserted posts do not shift a client's window or cause skips/duplicates the way
  `OFFSET` does. The constitution mandates URL-reflected, refresh-safe feed paging
  (Principle III); a `hash` cursor is a clean, shareable URL token.
- **Alternatives considered**: `page`/`OFFSET` paging — rejected: drifts as rows are
  inserted and gets slower at depth. Laravel `cursorPaginate()` — rejected: emits an
  opaque base64 cursor over arbitrary columns and a different envelope than the
  prototype's flat collection; a hand-rolled `hash` cursor matches the established
  contract and keeps the public token a real meme id (Principle V).

## R2 — Ordering and tie-break

- **Decision**: Order by `activated_at DESC, id DESC`. The cursor filter is
  `activated_at < $cursor->activated_at AND id < $cursor->id`.
- **Rationale**: `activated_at` is newest-first feed order; `id` is the monotonic
  tie-break so posts sharing an `activated_at` (or null-second precision) keep a total
  order and the cursor never skips or repeats. This mirrors the prototype.
- **Alternatives considered**: Order by `id` only — rejected: activation, not
  insertion, defines feed recency. Order by `created_at` — rejected: a post is visible
  from `activated_at`, which is the meaningful "appeared in feed" moment.

## R3 — Page size default and maximum

- **Decision**: Default `limit` = **10**; hard maximum = **50**. Invalid `limit`
  (non-numeric, ≤ 0) falls back to 10; values above 50 are clamped to 50.
- **Rationale**: The constitution fixes the feed batch at 10 (Principle III / Tech
  Constraints). A maximum bounds response size and protects the server from a client
  requesting an unbounded list (Principle VI). The prototype defaulted to 3 only as a
  test convenience — 10 is the constitutional value.
- **Alternatives considered**: No cap — rejected (unbounded query is a DoS/abuse
  vector). Cap = 10 (no override below) — rejected: allowing a smaller `limit` is
  harmless and useful for tests and lightweight clients.

## R4 — Visibility filter

- **Decision**: Visible ⇔ `activated_at IS NOT NULL` **and** not soft-deleted. Applied
  to both the feed and the single-post lookup. The single-post lookup uses the same
  visibility builder so hidden/deleted posts 404 rather than 200.
- **Rationale**: Matches the prototype (`whereNotNull('activated_at')` +
  `whereNull('deleted_at')`). Eloquent `SoftDeletes` already hides trashed rows from
  default queries; the explicit `activated_at` check additionally hides drafts/queued
  posts. Keeping `show()` on the same builder closes the leak where a hidden post is
  reachable by direct URL.
- **Alternatives considered**: Filtering visibility only in the feed and letting
  `show()` find any row — rejected: would expose unpublished/soft-deleted posts via a
  guessed/shared `hash`.

## R5 — Image URL building: reuse `MediaPath` + `Storage`, existing-only sizes

- **Decision**: A new `App\Services\TrashpostImageService` derives `code`/`ext` from a
  post's `file` via `pathinfo`, then for each `MediaPath::imageSizes()` builds the
  relative path with `MediaPath::imageRelativePath($size, $code, $ext)`, keeps only
  sizes where `Storage::disk('public')->exists($rel)`, and maps each kept size to
  `Storage::disk('public')->url($rel)`. Numeric sizes become `{url, width}` (widest
  first); `original` is exposed separately; `default` is the `800` URL when present,
  else the widest available, else `original`. A post with no `file` returns empty image
  data (no error).
- **Rationale**: The prototype's `TrashpostPathService::getImageInfo(..., existingOnly: true)`
  does the same "list only what exists" behavior. Reusing `MediaPath` keeps the single
  source of truth for path/shard/size rules (feature 003) and avoids duplicating logic
  — satisfying DRY and Principle I (no second helper). `Storage::disk('public')->url()`
  produces the public URL consistently for MySQL-runtime and the faked disk in tests.
- **Alternatives considered**: Re-deriving paths inside the resource — rejected:
  duplicates `MediaPath` and is not independently testable. Trusting a `metadata` size
  list without checking disk — rejected: would emit URLs for missing files (broken
  images), violating FR-010. (An optional `metadata.width` fallback from the prototype
  is deferred unless cheap; see quickstart.)

## R6 — Response envelope and resource shape

- **Decision**: `index` returns `TrashpostResource::collection(...)` (a JSON array of
  posts under Laravel's default `data` envelope); `show` returns a single
  `TrashpostResource`. Each resource = the model's stored fields + `url`
  (`/posts/{hash}`, the future frontend deep link) + `url_api` (`route('api.posts.show')`)
  + `original` + `default` + `sizes`.
- **Rationale**: Mirrors the prototype's `TrashpostResource` (`url`, `url_api`,
  `original`, `default`, `sizes`). `JsonResource` gives consistent, context-escaped
  JSON (Principle VI). `url_api` is built from the named route so it stays correct if
  the path changes; `url` is a plain string because no web route exists yet (frontend
  is a later feature).
- **Alternatives considered**: A bespoke array in the controller — rejected: scatters
  serialization and is harder to test than a `JsonResource`.

## R7 — Test data without the real media library

- **Decision**: Add `Database\Factories\TrashpostFactory` with states for visible,
  hidden (null `activated_at`), soft-deleted, and link-only (null `file`, YouTube set)
  posts. Image-size tests use `Storage::fake('public')` and write a few small fake
  files at `MediaPath::imageRelativePath(...)` to assert existing-only behavior.
- **Rationale**: `RefreshDatabase` + factory is the established backend test pattern
  (see `UserFactory`, `TrashpostTest`). `Storage::fake('public')` (used by feature
  003's seed tests) lets image-URL tests run without the 1.3 GB seeded library and
  keeps tests fast and hermetic. The model is unguarded enough (`$fillable`) for the
  factory to set `hash`, `file`, `activated_at`, etc.
- **Alternatives considered**: Depending on real seeded media — rejected: slow,
  environment-dependent, and unavailable in CI.
