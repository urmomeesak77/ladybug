# Feature Specification: Read-Side Feed API (Posts Feed & Single Post)

**Feature Branch**: `004-read-feed-api`

**Created**: 2026-06-09

**Status**: Draft

**Input**: User description: "Read-only meme feed API over existing seeded data. GET /api/posts returns the newest activated, non-deleted posts (10 per page) with cursor pagination via a `start` post hash and an optional `limit` (capped); GET /api/posts/{hash} returns one post or 404. Each post serializes its DB fields plus shareable URLs and the URLs of every image size that actually exists on disk. No auth, no writes. Uses the existing Trashpost model/table and the App\Support\MediaPath helper; routes and classes use the prototype 'Trashpost / hash' vocabulary."

## Overview

The Ladybug backend already has the posts table, the seeded image library, and the
media-path helper, but it exposes **no way to read posts** — only a health probe.
This feature delivers the **read-side API** that turns the stored data into a
browsable meme feed: a paginated list endpoint that returns the newest visible posts
newest-first, and a single-post endpoint addressed by the post's public `hash`.

Each returned post carries its stored fields plus the URLs needed to render it: a
shareable link to the post and the URLs of every image size that actually exists on
disk for that post. This is the contract the frontend feed and single-meme page will
consume.

This is a **read-only** feature: no authentication, no creating, editing, or deleting
posts, and no upload pipeline. It serves data already present from features 002
(schema) and 003 (seeded media).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the newest posts in a paginated feed (Priority: P1)

As a visitor, I want to fetch the newest visible posts in small pages and keep
loading older ones, so I can scroll an endless feed of memes without downloading
everything at once.

**Why this priority**: The feed is the core of the site; without it there is nothing
to browse and the frontend has no data source. Everything else builds on it.

**Independent Test**: Seed a set of visible posts, request the feed, and confirm it
returns the newest 10 (newest-first); then request the next page using the last
post's identifier as the cursor and confirm only older posts follow, with no overlap
or gap.

**Acceptance Scenarios**:

1. **Given** more than 10 visible posts exist, **When** I request the feed with no
   parameters, **Then** I receive the 10 newest visible posts ordered newest-first.
2. **Given** the first page of results, **When** I request the feed again using the
   last returned post's identifier as the `start` cursor, **Then** I receive the next
   batch of strictly older posts with no duplicates from the first page.
3. **Given** I pass a `limit` smaller than the default, **When** I request the feed,
   **Then** I receive at most that many posts.
4. **Given** I pass a `limit` larger than the allowed maximum, **When** I request the
   feed, **Then** the response is capped at the maximum rather than returning an
   unbounded list.
5. **Given** an unknown or malformed `start` cursor, **When** I request the feed,
   **Then** the cursor is ignored and the newest page is returned (no error).

---

### User Story 2 - Open a single post by its shareable identifier (Priority: P1)

As a visitor following a shared link, I want to fetch one specific post by its public
identifier, so the single-meme page can render it directly and the URL is shareable.

**Why this priority**: Shareable per-post URLs are required by the constitution
(every view has a real URL) and the single-post page depends on this endpoint. It is
as essential as the feed itself.

**Independent Test**: Request a known visible post by its `hash` and confirm its data
is returned; request a non-existent or hidden post and confirm a 404.

**Acceptance Scenarios**:

1. **Given** a visible post with a known `hash`, **When** I request that post by
   `hash`, **Then** I receive that post's data.
2. **Given** a `hash` that matches no post, **When** I request it, **Then** I receive
   a 404 (not found) response.
3. **Given** a post that is hidden (not activated) or soft-deleted, **When** I request
   it by `hash`, **Then** I receive a 404 — hidden posts are not reachable.

---

### User Story 3 - Render each post with its available image sizes (Priority: P2)

As the frontend, I want each post to include the URLs of every image size that
exists for it, so I can pick the right resolution and never request a missing file.

**Why this priority**: The feed and post data are usable without perfect size
metadata, but correct, existing-only image URLs are what makes posts actually render
and avoids broken images. It builds directly on US1/US2.

**Independent Test**: For a post whose image exists in only some sizes on disk,
confirm the response lists exactly those sizes (with their widths) and omits the
missing ones, and that a link-only post (no image) is returned without image URLs and
without error.

**Acceptance Scenarios**:

1. **Given** a post whose image exists in sizes `original`, `300`, and `100` on disk,
   **When** I fetch the post, **Then** the response lists exactly those three sizes
   (each with its URL and width) and no missing size.
2. **Given** a post that has no stored image file (e.g. a YouTube link), **When** I
   fetch it, **Then** the response contains no image size URLs and produces no error.
3. **Given** any post with at least one image size on disk, **When** I fetch it,
   **Then** the response provides a usable default image URL for rendering.

---

### Edge Cases

- **Empty feed**: No visible posts → the feed returns an empty list (not an error).
- **Hidden posts excluded**: Posts with no activation timestamp and soft-deleted
  posts never appear in the feed and 404 on direct lookup.
- **Cursor at the end**: A `start` cursor pointing at the oldest post returns an empty
  next page.
- **Invalid `limit`**: Non-numeric, zero, or negative `limit` falls back to the
  default; oversized `limit` is capped to the maximum.
- **Missing image files on disk**: A post references a file but some/all sizes are
  absent on disk → only the sizes that exist are listed; absent ones are omitted.
- **Link-only / no-image posts**: Returned with empty image data, never an error.
- **Tie-break ordering**: Posts sharing an activation timestamp are ordered
  deterministically so pagination never skips or repeats a post.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a read-only feed endpoint that returns visible
  posts ordered newest-first.
- **FR-002**: A post is **visible** only when it has an activation timestamp and is
  not soft-deleted; the feed and single-post lookup MUST exclude all non-visible
  posts.
- **FR-003**: The feed MUST return at most a default page size of **10** posts when no
  page size is specified.
- **FR-004**: The feed MUST accept an optional `limit` to request fewer posts, and
  MUST cap `limit` at a defined maximum to prevent unbounded responses; invalid
  `limit` values MUST fall back to the default.
- **FR-005**: The feed MUST support cursor pagination via an optional `start`
  parameter equal to a post's public `hash`; results MUST contain only posts strictly
  older than the referenced post, with a deterministic tie-break so no post is
  duplicated or skipped across pages.
- **FR-006**: An unknown or malformed `start` cursor MUST be ignored (the newest page
  is returned) rather than causing an error.
- **FR-007**: The system MUST expose a single-post endpoint addressed by a post's
  public `hash` that returns that post when visible.
- **FR-008**: The single-post endpoint MUST return a 404 when no visible post matches
  the `hash` (unknown, not activated, or soft-deleted).
- **FR-009**: Each returned post MUST include its stored fields plus a shareable
  reference to the post and a reference to its API endpoint.
- **FR-010**: Each returned post MUST include the URLs of every image size that
  actually exists on disk for that post (each with its width), and MUST omit sizes
  whose files are absent; the system MUST NOT fabricate or resize images.
- **FR-011**: Each returned post MUST provide a usable default image URL when at least
  one image size exists, and MUST return empty image data (no error) when the post has
  no stored image.
- **FR-012**: The endpoints MUST be read-only — they MUST NOT create, modify, or
  delete posts, and MUST NOT require authentication.

### Key Entities *(include if feature involves data)*

- **Post**: A stored meme entry (the existing `trashposts` row). Carries a public
  `hash` (shareable identifier), an optional title, a type, an optional image
  `file`, an optional YouTube link, optional comment/metadata, an owner reference, and
  timestamps including the activation timestamp that governs visibility.
- **Feed page**: An ordered, bounded slice of visible posts (newest-first), advanced
  by a `start` cursor referencing the last post of the previous page.
- **Image size set**: For a post with a stored image, the set of size variants
  (`original`, `800`, `500`, `300`, `100`) that exist on disk, each exposed as a URL
  plus its width; sizes absent on disk are excluded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A client can retrieve the newest visible posts and page backward through
  the entire visible set in fixed-size pages, with every visible post appearing
  exactly once across pages (no duplicates, no gaps).
- **SC-002**: 100% of non-visible posts (not activated or soft-deleted) are absent
  from the feed and return 404 on direct lookup.
- **SC-003**: For any post, the image sizes reported in the response exactly match the
  size files that exist on disk for that post (no missing-file URLs, no omitted
  existing sizes).
- **SC-004**: A shared single-post link resolves to exactly the intended post by its
  public `hash`, and an invalid identifier yields a clear 404.
- **SC-005**: The default feed page returns no more than 10 posts, and no request can
  cause the feed to return more than the defined maximum.
- **SC-006**: The read endpoints are covered by automated tests for happy paths and
  the edge cases above, meeting the project's ≥90% line-coverage gate.

## Assumptions

- **Vocabulary**: Per the user's decision, the API uses the prototype "Trashpost /
  `hash`" vocabulary and routes (`/api/posts`, `/api/posts/{hash}`); the existing
  `trashposts` table and `Trashpost` model are used unchanged (no rename to "meme").
- **Cursor over offset**: Pagination is cursor-based (a `hash` marking the last seen
  post), matching the prototype, rather than page-number/offset paging. This keeps the
  feed stable as new posts arrive and supports endless scroll.
- **Default & maximum page size**: Default page size is 10 (per the constitution's
  "feed loads 10 at a time"); a sensible maximum cap (e.g. 50) bounds `limit`.
- **Image layout**: Image URLs are derived from the canonical media layout defined in
  feature 003 (`image/trash/{size}/{shard}/{code}.{ext}`) via the existing path
  helper; this feature only reads/serves URLs, it does not move or generate files.
- **Existing-only sizes**: Whether a size exists is determined by checking the file on
  disk, consistent with the prototype's behavior; missing variants are simply omitted.
- **Read-only scope**: No auth layer is involved; these endpoints are public, matching
  a public meme feed. Owner-only or write operations are out of scope.

## Out of Scope

- Creating, editing, deleting, or uploading posts and media (write side / upload
  pipeline).
- Authentication, authorization, and account-scoped views.
- Searching/filtering the feed beyond what cursor pagination requires (advanced
  filters, full-text search).
- Frontend rendering of the feed or single-post page (separate feature).
- Generating or resizing images, or backfilling missing size variants.

## Dependencies

- Feature 002 (database schema): the `trashposts` table and `Trashpost` model with
  the `hash`, `activated_at`, `deleted_at`, and `file` columns.
- Feature 003 (media storage): the seeded image library on the public storage disk and
  the `App\Support\MediaPath` path/shard/size helper used to locate image files.
- The earlier "Trashpost" prototype (`C:\projects\trash`) as the reference for the
  feed/query and response shape (`TrashpostsApiController`, `TrashpostResource`).
