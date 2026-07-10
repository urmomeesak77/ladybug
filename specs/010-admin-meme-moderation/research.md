# Phase 0 Research: Admin Meme Moderation Table

All Technical Context items were resolvable from the existing codebase and constitution; no
`NEEDS CLARIFICATION` remained after the spec's three clarifications. This document records
the design decisions and the alternatives weighed.

## R1 — Role gate: middleware vs. inline checks

**Decision**: Add a small `EnsureRole` middleware, aliased `role` in `bootstrap/app.php`,
used as `role:admin` on an `/api/admin/posts` route group behind `auth:sanctum`. The gate
compares `Role::rank()`: `role:admin` admits any role whose rank ≥ `Role::Admin` (admin,
superuser) and returns **403** otherwise. Unauthenticated requests are rejected **401** by
`auth:sanctum` before `role` runs, so guests never reach the gate.

**Rationale**: The codebase already has the authoritative `App\Enums\Role` (rank +
`outranks`) from 009 but *no* privilege-enforcement middleware yet — 009 explicitly left
gating to a future feature. One reusable, parameterized middleware keeps the check in exactly
one place (Principle VI) and reads naturally on the route. The 401-vs-403 split matches the
spec: guests are "refused" (unauthenticated) and members are "refused" (forbidden), both
covered.

**Alternatives considered**:
- *Inline `abort_unless` in the controller* — duplicates the check across five actions and
  is easy to forget on a new endpoint. Rejected.
- *Laravel Gate/Policy* — heavier than needed for a single "rank ≥ admin" rule and would
  spread the role logic across a policy class; the enum already encodes the order. Rejected
  for now (a policy can wrap the same enum later without changing routes).

## R2 — Pagination model: page-based offset, not keyset

**Decision**: The moderation index uses Eloquent's **page-based** paginator
(`->orderByDesc('created_at')->orderByDesc('id')->paginate(100)`), driven by a `?page=N`
query param, returning `data` + `meta` (current page, last page, total). The frontend renders
numbered/dedicated links that set `?page=N`.

**Rationale**: The spec explicitly calls for numbered/dedicated page links (not infinite
scroll) and a bookmarkable, refresh-safe URL (FR-004/FR-005, Assumptions). This is a
back-office table distinct from the public feed's keyset+"Load more" model, so reusing the
feed's `start`-cursor keyset would be the wrong ergonomics (no random page access, no total
count). Offset pagination over an indexed `created_at,id` order is fine at 100/page for a
moderation tool. Out-of-range pages return an empty `data` with valid `meta` (last page),
which the UI renders as a last-page/empty state rather than an error (edge case).

**Alternatives considered**:
- *Keyset (`start` hash) like the feed* — no page numbers, no jump-to-page, no total;
  contradicts the spec's dedicated-links requirement. Rejected.

## R3 — Surfacing all states (including soft-deleted)

**Decision**: The index query uses `Trashpost::withTrashed()` and **no** `activated_at`
filter, so it returns memes in every state. Action lookups also use
`Trashpost::withTrashed()->where('hash', $hash)` so a deleted meme can still be found to
Restore.

**Rationale**: `Trashpost` uses `SoftDeletes`, whose global scope hides `deleted_at IS NOT
NULL` rows by default — the exact rows a moderation console must show (FR-006, Assumptions).
"Activated" is represented by `activated_at` (nullable timestamp), so simply *not* filtering
it surfaces unactivated memes too. The public feed/show paths are unchanged and keep their
`whereNotNull('activated_at')` + default soft-delete scope, so soft-deleted/unactivated memes
remain invisible publicly (FR-006, US4 acceptance #3).

## R4 — Activated / Deleted representation

**Decision**: Reuse the existing columns. `activated_at` (nullable `timestamp`) — non-null ⇒
activated. `deleted_at` (SoftDeletes) — non-null ⇒ deleted. The row resource emits derived
booleans `activated` and `deleted`. State transitions:

| Action | Effect |
|--------|--------|
| Activate | `activated_at = now()` |
| Deactivate | `activated_at = null` |
| Delete | `$post->delete()` (soft — sets `deleted_at`) |
| Restore | `$post->restore()` (clears `deleted_at`) |

**Rationale**: No schema churn for state; the columns already exist and the feed uses
`activated_at`. Deactivate is the natural inverse (return to not-activated). Soft delete
already retains data + media (Assumptions). Concurrent/repeated actions are idempotent
against the target state — the second writer simply lands the row in the same final state
(edge case: concurrent moderation, repeated toggles).

## R5 — Thumbnails: image vs. YouTube

**Decision**:
- **Image memes** — the thumbnail URL is the existing **`100`-size** variant resolved from
  the meme's `file` via `MediaPath::imageRelativePath('100', code, ext)` on the `public`
  disk. If that file is absent, the resource emits `thumbnail: null` and the UI shows a
  placeholder (FR-009/FR-011).
- **YouTube memes** — a `YoutubeThumbnailService` ensures a locally stored still exists: if
  `youtube_thumbnail` is set, use it; otherwise fetch `https://img.youtube.com/vi/{id}/
  mqdefault.jpg` **once**, store it under a dedicated subtree, persist the relative path to
  `youtube_thumbnail`, and return its URL. On any failure it returns `null` (placeholder) and
  leaves the column unset.
- **Anything else / malformed media** — `thumbnail: null` → placeholder.

**Rationale**: The `100` variant is exactly the compact size the table needs (clipped to
100×75 in CSS, `object-fit: cover`, `overflow: hidden` per FR-008). `mqdefault.jpg`
(320×180) is a safe, always-present YouTube still that downsizes cleanly to the cell.
Composing the remote URL from the **validated** 11-char id (`Youtube::extractId`, which the
stored `youtube` column already holds) — never from raw user input — satisfies Principle VI.

**Alternatives considered**:
- *`hqdefault.jpg`/`maxresdefault.jpg`* — larger downloads for a 100px cell; `maxres` is not
  guaranteed to exist. `mqdefault` is smaller and universally present. Rejected the larger
  variants.
- *YouTube Data API* — needs an API key/secret and a new dependency/credential; the static
  `img.youtube.com` path needs neither. Rejected (Principle I).

## R6 — Lazy, synchronous, one-time YouTube fetch (no queue)

**Decision**: The fetch happens **inside the index request** the first time a YouTube meme
lacking `youtube_thumbnail` appears. It is synchronous, best-effort, and wrapped so a single
failure never breaks the row or the rest of the table. Success stores the file + column so it
is never fetched again (SC-004). Failure returns a placeholder; the column stays null, so a
later render may retry (acceptable — "at most once" concerns *successful* downloads; a
transient network blip should not permanently pin a placeholder).

**Rationale**: The spec's clarification chose lazy-synchronous explicitly and ruled out queue
infrastructure. The download uses Laravel's HTTP client (`Http::timeout(...)->get(...)`) —
already bundled, no new dependency. Per-request cost is bounded: only *new* YouTube memes on
the visible page incur it, and only once each.

**Testing note**: `YoutubeThumbnailService` must be unit-testable **without network**. Tests
use `Http::fake()` to stub the remote fetch (success + failure) and `Storage::fake('public')`
to assert the file is written and the column set. This honors "tests never hit the network /
real DB".

## R7 — Delete confirmation (modal)

**Decision**: Delete is confirmed in a **blocking modal dialog** (native `<dialog>` +
`showModal()`), raised app-level through `NoticeProvider` via a new `useNotice().ask()`;
Activate, Deactivate, and Restore apply on a single click (FR-016 clarification).

**Rationale**: Originally an inline in-cell Confirm/Cancel pair; once the action buttons
became compact icons, the text pair overflowed the actions column (revised 2026-07-10 —
see docs/superpowers/specs/2026-07-10-modal-delete-confirm-design.md). A modal fits any
row width and blocks stray page actions while the decision is pending. The existing
`NoticeProvider`/`NoticeDialog` already established the native-dialog pattern, so the
confirm extends that infrastructure with a two-button `ConfirmDialog` sibling.

**Alternatives considered**:
- *`window.confirm`* — not themeable/accessible-controllable, blocks the event loop, and
  reads as unpolished. Rejected.
- *New `ConfirmDialog` + provider* — more surface than a single destructive action warrants.
  Rejected in favor of the inline two-step.

## R8 — Staying on the same page after an action

**Decision**: Actions return the **updated row resource**; `useModeration` replaces just that
row in local state, leaving the current `?page` and scroll position untouched (FR-017). No
full page reload/refetch.

**Rationale**: A per-row PATCH-style response is the minimal round-trip and avoids re-paging
(which could shuffle rows if new memes arrived). The row re-renders with its new
activated/deleted state and the correct inverse controls.

## R9 — Role mirroring on the frontend

**Decision**: Reuse the 009 `lib/role.ts` `Role` class and the `useAuth().role` effective
role. A new `RequireRole` route wrapper blocks below-admin (redirect home while resolved;
render nothing while `status === 'unknown'` to avoid a flash, mirroring `RequireAuth`). The
LeftMenu shows the Moderation link only when `Role.rank(role) >= Role.rank('admin')`.

**Rationale**: The role vocabulary and effective-role plumbing already exist from 009; this
feature is their first real consumer. The UI gate is a discoverability/UX aid only — the
server gate (R1) is the security boundary (FR-001a, FR-002). Client-side hiding never
substitutes for the server check.
