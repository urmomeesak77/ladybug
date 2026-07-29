# Feature Specification: SEO & Social-Sharing Discoverability

**Feature Branch**: `016-seo-discoverability`

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "SEO and social-sharing discoverability for the public site. Every URL returns an identical SPA shell with the title 'online-trash' and no content, description, image, or canonical. Titles are set client-side only, so social platforms — which do not run JavaScript — render every shared meme link as a blank preview card, and search engines get no snippet, no image, and no crawlable path to the archive."

## Context

Measured against the live site on 2026-07-29:

| Probe | Result | Expected |
|---|---|---|
| `GET /` | 462-byte shell, `<title>online-trash</title>` | Title + description + preview image |
| `GET /posts/{hash}` | Byte-identical shell | The meme's own title, description, image |
| `GET /posts/zzzzzzzzzz` | `200` | `404` |
| `GET /nonexistent-route` | `200` | `404` |
| `GET /robots.txt` | `200` + `text/html` (the shell) | `200` + `text/plain` |
| `GET /sitemap.xml` | `200` + `text/html` (the shell) | `200` + XML |
| `GET /assets/index-*.js` | 250,120 bytes, no `Content-Encoding` | ~80 KB compressed |

The archive is additionally unreachable: meme identifiers are opaque 10-character codes,
the home feed links only its first batch, and the one durable link to the next page appears
only after 200 entries have auto-loaded on scroll — which no crawler will trigger.

## Clarifications

### Session 2026-07-29

- Q: When the initial response's metadata cannot be produced (backend/database unavailable or the meme lookup errors), what must the site do? → A: Serve the shell with generic site-level metadata plus a do-not-index instruction and report success; the client application boots and shows its own error state as today.
- Q: Is the derived per-address page metadata cached server-side, and on what interval? → A: Yes — cached per address on a 1-hour refresh interval, matching the address listing.
- Q: How does a meme's visibility change (hide, delete, restore) reach the 1-hour metadata cache? → A: Every visibility transition invalidates that address's cached metadata, so the next request reflects it immediately.
- Q: Does a soft-deleted meme's permalink report success or missing? → A: Success, with generic metadata and a do-not-index instruction — same as a pending meme; only a purged or never-existing identifier reports missing.
- Q: What is the latency ceiling for the initial response on a cold cache? → A: 300 ms server time at the 95th percentile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A shared meme link shows what it is (Priority: P1)

A visitor finds a meme they like and pastes its permalink into a chat, a forum, or a social
post. The link unfurls into a preview card carrying the meme's own title, a short
description, and the meme's image. Anyone seeing that card can tell what they are about to
click, and the click-through brings a new visitor to the site.

**Why this priority**: Sharing is the primary growth channel for a meme site, and it is
currently 100% broken — every shared link is an identical blank card. This single story
converts every existing meme permalink from worthless to shareable, and it is the
prerequisite for search engines producing a usable result snippet. It delivers value with
nothing else in this feature built.

**Independent Test**: Request a meme permalink without executing any client-side code and
confirm the response body carries that meme's title, description, canonical address, and
image reference. Verify the rendered page is visually and behaviourally unchanged.

**Acceptance Scenarios**:

1. **Given** a publicly visible meme with a title and an image, **When** its permalink is
   requested and no client-side code runs, **Then** the response carries that meme's title,
   a description, its canonical address, and a reference to its largest available image.
2. **Given** the same permalink, **When** it is opened in a normal browser, **Then** the page
   renders and behaves exactly as it does today, with no visible change and no additional
   loading step.
3. **Given** a publicly visible meme whose media is a YouTube link, **When** its permalink is
   requested without client-side code, **Then** the response carries the video's thumbnail as
   the preview image and identifies the entry as a video.
4. **Given** the home feed address, **When** it is requested without client-side code,
   **Then** the response carries a site-level title, a site description, a canonical address,
   and a branded preview image.
5. **Given** a meme that is not publicly visible (pending activation or deleted), **When** its
   permalink is requested, **Then** the response carries no part of that meme's title,
   description, or image, and instructs indexers not to index the address.
6. **Given** a meme whose title contains characters with meaning in the response format
   (quotes, angle brackets, ampersands), **When** its permalink is requested, **Then** the
   title is correctly escaped and cannot alter the structure of the response.

---

### User Story 2 - Search engines can reach every meme (Priority: P2)

A search engine crawls the site and discovers every publicly visible meme, not just the
newest handful, so old memes accumulate search traffic instead of being permanently
invisible. The crawler is also told plainly which parts of the site are not worth crawling.

**Why this priority**: Without this, the metadata from US1 only ever applies to the ~10
newest memes — the rest of the archive can never be found. It is second only because a
crawlable archive of blank pages would be worth little; metadata first, then reach.

**Independent Test**: Retrieve the machine-readable address listing and confirm it enumerates
every publicly visible meme, and only those. Retrieve the crawler instruction file and
confirm it is served in the correct format and names the listing.

**Acceptance Scenarios**:

1. **Given** a set of publicly visible memes, **When** the address listing is retrieved,
   **Then** it contains the permalink of every one of them plus the public static addresses.
2. **Given** memes that are pending activation or deleted, **When** the address listing is
   retrieved, **Then** none of their permalinks appear.
3. **Given** more publicly visible memes than a single listing may hold, **When** the listing
   is retrieved, **Then** it is delivered as a set of linked listings, each within the
   published size and count limits.
4. **Given** the crawler instruction file address, **When** it is requested, **Then** it is
   returned as plain text, names the address listing, and disallows the sign-in, registration,
   account, upload, e-mail-verification, and administration areas.
5. **Given** a meme is newly activated or removed, **When** the address listing is retrieved
   after the agreed refresh interval, **Then** the listing reflects that change.
6. **Given** repeated retrievals of the address listing, **When** they occur within the
   refresh interval, **Then** the underlying data is not re-queried for each request.

---

### User Story 3 - Pages load fast enough to rank (Priority: P3)

Visitors on phones and slow connections get the site quickly, and the site is not penalised
in search rankings for being slow to become usable.

**Why this priority**: Entirely self-contained, cheap, and zero-risk to behaviour, but it
affects ranking rather than creating discoverability. The site currently transfers its main
client-side bundle completely uncompressed.

**Independent Test**: Request each text-based asset advertising support for compressed
transfer and confirm the response is compressed and materially smaller, with byte-identical
content once decompressed.

**Acceptance Scenarios**:

1. **Given** a client that advertises support for compressed transfer, **When** it requests a
   text-based asset (markup, styles, scripts, the address listing, the crawler instructions),
   **Then** the response is transferred compressed.
2. **Given** the same request, **When** the response is decompressed, **Then** its content is
   byte-identical to the uncompressed response.
3. **Given** a client that does not advertise compression support, **When** it requests any
   asset, **Then** it receives a valid uncompressed response.
4. **Given** an already-compressed asset (images, media), **When** it is requested, **Then**
   it is not re-compressed.

---

### User Story 4 - Missing pages report as missing (Priority: P4)

A crawler or a visitor following a stale link to a meme that no longer exists is told the
address is gone, rather than being handed a page that claims success.

**Why this priority**: Prevents search engines indexing garbage addresses and reporting
site-wide soft-404 errors, which suppresses the value of the correctly-indexed pages. Lower
than the above because it protects quality rather than creating reach.

**Independent Test**: Request a well-formed but unknown meme address and an unmatched address,
and confirm both report the resource as missing while still presenting the site's own
not-found page to a human visitor.

**Acceptance Scenarios**:

1. **Given** a well-formed meme identifier that matches no meme, **When** its permalink is
   requested, **Then** the response reports the resource as missing.
2. **Given** any address matching no known view, **When** it is requested, **Then** the
   response reports the resource as missing.
3. **Given** either of the above, **When** the page is opened in a normal browser, **Then**
   the site's existing not-found page is displayed, unchanged.
4. **Given** a publicly visible meme, **When** its permalink is requested, **Then** the
   response reports success.
5. **Given** a meme record that exists but is pending activation or soft-deleted, **When** its
   permalink is requested, **Then** the response reports success and carries generic site
   metadata with a do-not-index instruction, not a missing status.
6. **Given** the metadata cannot be produced at all, **When** any public address is requested,
   **Then** the response still delivers the shell and reports success rather than an error.

---

### User Story 5 - Memes qualify for rich search results (Priority: P5)

Memes become eligible for image and video results and for the enhanced presentations search
engines give to pages that describe their content in a machine-readable form.

**Why this priority**: A multiplier on US1 and US2 rather than a standalone capability — it
only pays off once pages carry metadata and are reachable. Valuable but strictly additive.

**Independent Test**: Retrieve a meme permalink without client-side code and confirm it
carries a valid machine-readable description of the entry that passes a structured-data
validator.

**Acceptance Scenarios**:

1. **Given** a publicly visible image meme, **When** its permalink is requested, **Then** the
   response carries a valid machine-readable description identifying it as an image, with its
   address, title, image reference, publication date, and author name.
2. **Given** a publicly visible YouTube meme, **When** its permalink is requested, **Then** the
   response carries a valid machine-readable description identifying it as a video, with its
   thumbnail and publication date.
3. **Given** any publicly visible meme permalink, **When** its response is checked, **Then**
   the machine-readable description includes the path from the home feed to that meme.
4. **Given** a meme that is not publicly visible, **When** its permalink is requested, **Then**
   the response carries no machine-readable description of it.
5. **Given** any generated machine-readable description, **When** it is parsed, **Then** it is
   well-formed and every value in it matches the corresponding visible content.

---

### User Story 6 - Page structure reads correctly (Priority: P6)

The home feed announces what it is with a single top-level heading, and the feed's paged
addresses do not compete with the home feed as separate search results.

**Why this priority**: Small, contained corrections to existing markup. Real but marginal
compared with the stories above, and it touches the visible page, so it carries the most
regression risk per unit of value.

**Independent Test**: Inspect the home feed's heading structure, and confirm a paged feed
address declares the home feed as its canonical address.

**Acceptance Scenarios**:

1. **Given** the home feed, **When** its heading structure is inspected, **Then** it has
   exactly one top-level heading naming the site or the feed, and meme titles remain at the
   level below it.
2. **Given** a paged feed address carrying a page cursor, **When** it is requested, **Then**
   it declares the un-cursored home feed as its canonical address.
3. **Given** the added heading, **When** the page is viewed in light and dark appearance and
   at mobile, tablet, and desktop widths, **Then** the layout is intact and the heading is
   legible in both appearances.
4. **Given** the added heading, **When** the page is read with assistive technology, **Then**
   the heading order is sequential with no skipped levels.

---

### Edge Cases

- **Meme with no title.** Titles are required for new uploads, but older entries may lack
  one. The metadata falls back to a generic entry name and the site description; the
  address listing still includes the meme.
- **Meme with no media.** An entry that is neither an image nor a resolvable video falls back
  to the branded site preview image rather than emitting a broken image reference.
- **Very long title.** Titles are truncated to the length limits of each metadata field on a
  word boundary, with no mid-word cuts and no truncation of the visible page heading.
- **Title containing markup or quotes.** Escaped for its position in the response; it must be
  impossible for a meme title to alter the response structure or inject executable content
  (Constitution VI).
- **An administrator opening a pending or deleted meme.** The page must still work for them —
  the metadata degrades to generic site metadata and a do-not-index instruction, but the page
  itself renders the meme as it does today.
- **A meme deleted after being listed.** It leaves the address listing at the next refresh, and
  its permalink immediately degrades to generic metadata with a do-not-index instruction while
  still reporting success; only a purge makes the identifier report the resource as missing.
- **A meme restored after deletion.** It returns to the address listing and to reporting
  success.
- **Address listing crossing the per-file limits.** Splits into a set of linked listings
  before either the maximum entry count or the maximum uncompressed size is reached.
- **Metadata caching collision.** Caching anywhere in the delivery path must never serve one
  meme's metadata for another meme's address, nor a signed-in view of a page to an anonymous
  requester.
- **Requests during a cold cache.** A first request after a cache expiry must still emit the
  shell within 300 ms of server time at the 95th percentile, rather than timing out.
- **Metadata source unavailable.** If the metadata cannot be produced at all, the address still
  serves the shell with generic site metadata and a do-not-index instruction and reports
  success; it never becomes unavailable because of a metadata failure (FR-038).
- **The shell itself unavailable.** Distinct from the above and deliberately *not* covered by
  FR-038's degradation: if the page shell cannot be read at all, there is no useful page left to
  serve, so the address reports a server error loudly rather than inventing an empty document.
  This is a packaging failure, and the deployment is expected to catch it at start-up rather
  than per request.
- **Empty site.** With no publicly visible memes, the address listing is still valid and
  contains the static public addresses.

## Requirements *(mandatory)*

### Functional Requirements

**Server-delivered page metadata (US1)**

- **FR-001**: The initial response for every public address MUST carry that address's own
  title, without requiring any client-side code to execute.
- **FR-002**: The initial response for every public address MUST carry a description
  summarising that page's content.
- **FR-003**: The initial response for every public address MUST declare its own canonical
  address as an absolute address on the site's single canonical origin.
- **FR-004**: The initial response for every public address MUST additionally expose the title
  of FR-001 and the description of FR-002 through social preview metadata sufficient for a
  link-unfurling client to render a titled card with an image, covering both the Open Graph and
  Twitter Card vocabularies. This restates no new content obligation — it fixes the *vocabulary*
  the values of FR-001/FR-002 must also be published in.
- **FR-005**: For a publicly visible meme, the preview image MUST be the largest image
  representation that exists for that meme, and for a video meme MUST be its video thumbnail.
- **FR-006**: Where no meme-specific preview image exists, the response MUST fall back to a
  branded site preview image.
- **FR-007**: All meme-supplied values placed into the response MUST be escaped for their
  position, such that no meme title or author name can alter the response structure or
  introduce executable content.
- **FR-008**: Metadata values MUST be truncated to the documented per-field length limits on a
  word boundary; the visible page content MUST NOT be truncated.
- **FR-009**: The page delivered to a browser MUST remain functionally and visually identical
  to the current page: the same client-side application takes over, the same views render, and
  no additional round-trip is introduced before first render. **Sole exception**: the home
  feed's top-level heading required by FR-032, which is a deliberate visible addition. No other
  visible change is permitted anywhere on the site.
- **FR-038**: When the metadata for an address cannot be produced (the metadata source is
  unavailable or the lookup errors), the response MUST still deliver the shell — carrying
  generic site-level metadata and a do-not-index instruction — and MUST report success, so the
  client-side application boots and surfaces the failure through its existing error handling. A
  metadata failure MUST NOT make an otherwise-working page unavailable.
- **FR-039**: The derived metadata for an address MUST be cached on a 1-hour refresh interval,
  keyed by address alone. Because the metadata is computed from public visibility only and never
  from the requester (see Assumptions), one cache entry serves every requester; the cache key
  MUST make it impossible to serve one address's metadata for another, or a signed-in view of a
  page to an anonymous requester.
- **FR-040**: A change to a meme's visibility (activation, deactivation, soft-deletion,
  restoration, or purge) MUST invalidate that meme's cached metadata, so the next request for
  its permalink reflects the new state. The 1-hour interval is an upper bound on unchanged
  entries only; it MUST NOT delay the effect of FR-010.

**Visibility and indexing control (US1, US4)**

- **FR-010**: A meme that is not publicly visible (pending activation or deleted) MUST NOT
  have any of its title, description, author, or image exposed in the initial response,
  regardless of who is requesting it.
- **FR-011**: An address for a non-publicly-visible meme MUST instruct indexers not to index
  it, while still rendering normally for a permitted viewer.
- **FR-012**: The sign-in, registration, account, upload, e-mail-verification, and
  administration addresses MUST instruct indexers not to index them.
- **FR-013**: A well-formed meme identifier matching no meme record at all (never existed, or
  purged) MUST report the resource as missing; an address matching no known view MUST report the
  resource as missing. A meme record that exists but is not publicly visible does NOT count as
  missing (FR-015).
- **FR-014**: An address reporting the resource as missing MUST still present the site's
  existing not-found view to a human visitor.
- **FR-015**: A publicly visible meme permalink MUST report success. A meme record that exists
  but is pending activation or soft-deleted MUST also report success — carrying the generic
  metadata and do-not-index instruction of FR-010 and FR-011 — so that a permitted viewer gets a
  working page.

**Crawlable archive (US2)**

- **FR-016**: The site MUST publish a machine-readable listing of every publicly visible meme
  permalink plus its public static addresses, at the conventional address for such a listing.
- **FR-017**: The listing MUST exclude every meme that is pending activation or deleted.
- **FR-018**: The listing MUST record each meme's publication date.
- **FR-019**: The listing MUST split into a set of linked listings before exceeding either the
  maximum entry count or the maximum uncompressed size defined by the sitemap protocol.
- **FR-020**: The listing MUST be cached so that repeated retrievals within the refresh
  interval do not re-query the underlying data, and MUST reflect activations, deletions, and
  restorations after that interval.
- **FR-021**: The site MUST publish crawler instructions at the conventional address, served
  as plain text, naming the address listing and disallowing the addresses named in FR-012.
- **FR-022**: The crawler instructions and the address listing MUST NOT be intercepted by the
  client-side application's catch-all address handling.
- **FR-023**: Meme media MUST remain retrievable by image crawlers.

**Structured data (US5)**

- **FR-024**: A publicly visible image meme's response MUST carry a valid machine-readable
  description identifying it as an image, including its address, title, image reference,
  publication date, and author name.
- **FR-025**: A publicly visible video meme's response MUST carry a valid machine-readable
  description identifying it as a video, including its thumbnail and publication date.
- **FR-026**: Every publicly visible meme's response MUST carry a machine-readable description
  of the path from the home feed to that meme.
- **FR-027**: Every value in a machine-readable description MUST match the corresponding
  visible content and the values in the social preview metadata.
- **FR-028**: A meme that is not publicly visible MUST have no machine-readable description of
  it in the response.

**Transfer efficiency (US3)**

- **FR-029**: Text-based responses (markup, styles, scripts, the address listing, the crawler
  instructions) MUST be transferred compressed to clients that advertise support, and MUST
  decompress to byte-identical content.
- **FR-030**: Clients not advertising compression support MUST receive valid uncompressed
  responses.
- **FR-031**: Already-compressed media MUST NOT be re-compressed.

**Page structure (US6)**

- **FR-032**: The home feed MUST have exactly one top-level heading; meme titles within the
  feed remain one level below it, and the heading order MUST be sequential with no skipped
  levels.
- **FR-033**: A paged feed address carrying a page cursor MUST declare the un-cursored home
  feed as its canonical address.
- **FR-034**: Any markup added by this feature MUST satisfy the existing appearance,
  responsive-layout, and accessibility rules (Constitution IV and VIII).

**Constraints**

- **FR-035**: This feature MUST NOT add any new runtime dependency to either stack
  (Constitution I).
- **FR-036**: This feature MUST NOT change the behaviour or response shape of the existing
  JSON API, the client-side application's views, the upload pipeline, or the media
  processing pipeline.
- **FR-037**: Automated tests covering this feature MUST hold total line coverage at or above
  90% on both stacks (Constitution VII), with tests mirroring the source structure.

### Key Entities

This feature introduces **no new stored data**. It derives everything it emits from existing
records.

- **Page Metadata**: The derived set of descriptive values for one address — title,
  description, canonical address, preview image, indexing instruction, and machine-readable
  description. Computed per request from an existing meme record or from site-level constants;
  never stored.
- **Address Listing**: The derived, cached enumeration of publicly visible meme permalinks and
  public static addresses, with publication dates. Computed from existing meme records;
  cached, not stored as a record.
- **Trashpost** *(existing, unchanged)*: Supplies title, public identifier, media type, image
  representations, video reference, author name, publication date, activation state, and
  deletion state. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of publicly visible meme permalinks produce a preview card carrying that
  meme's own title and image when shared, verified across the major link-unfurling clients —
  up from 0% today.
- **SC-002**: 100% of publicly visible memes are reachable by a crawler starting from a single
  entry point, up from approximately the newest 10 today.
- **SC-003**: 0 memes that are pending activation or deleted have any of their title,
  description, author, or image exposed to an unauthenticated requester.
- **SC-004**: 0 addresses that do not resolve to real content report success, verified by
  requesting a well-formed-but-unknown identifier, a purged identifier, and an unmatched
  address. (Confirming search-console reports no soft-404s is the operational follow-up of the
  same change, not a gate on this feature — account setup is out of scope.)
- **SC-005**: The bytes transferred for the **compressible payload** of a first-time visit to
  the home feed — the initial document, its stylesheets and its scripts — drop by at least 60%
  versus today's uncompressed transfer. Meme media is excluded from the measurement: it is
  already-compressed and deliberately not re-compressed (FR-031), so including it would measure
  the corpus rather than this feature.
- **SC-006**: 100% of the sign-in, registration, account, upload, e-mail-verification, and
  administration addresses are excluded from indexing by both the crawler instructions and a
  per-page instruction.
- **SC-007**: 100% of publicly visible meme permalinks pass a structured-data validator with
  no errors.
- **SC-008**: A meme newly activated or deleted is reflected in the published address listing
  within the documented refresh interval.
- **SC-009**: Rendering a page in a normal browser produces output indistinguishable from
  today's — apart from the home feed's new top-level heading (FR-032) — verified across light
  and dark appearance and mobile, tablet, and desktop widths.
- **SC-010**: Total line coverage remains at or above 90% on both stacks.
- **SC-011**: The initial response for any public address is emitted within 300 ms of server
  time at the 95th percentile, measured against a cold metadata cache. Measurement procedure:
  clear the cache, then issue 20 sequential requests to a meme permalink and take the 95th
  percentile of server time-to-first-byte; the first request of the run is the cold one and is
  included, not discarded.

## Assumptions

Reasonable defaults chosen where the description did not specify. Each is a decision that can
be revisited during planning without reopening scope.

**Metadata content**

- The site name used in titles is **online-trash**. A meme page's title reads
  `{meme title} - online-trash`, matching the existing client-side title format so nothing
  changes for a human visitor.
- Where a meme has no title, its metadata falls back to a generic entry name plus the site
  description, matching the existing `Untitled meme` fallback in the feed.
- Field length limits follow current platform behaviour: description ~155 characters, social
  title ~60, social description ~200. Values are truncated on a word boundary with an ellipsis.
- The branded fallback preview image is derived from the existing site logo assets; no new
  artwork is commissioned as part of this feature.
- The site-level description is new copy written during implementation; it is not derived from
  any existing string.

**Visibility**

- "Publicly visible" means exactly what the existing public feed query means: activated and not
  soft-deleted. This feature introduces no second definition of visibility.
- Server-delivered metadata is computed from **public** visibility only, never from the
  requester's role. An administrator viewing a pending meme still gets generic metadata and a
  do-not-index instruction in the initial response; the meme itself renders via the existing
  viewer-aware data path, unchanged. This keeps the initial response independent of the
  requester and therefore safely cacheable.
- An existing-but-not-public meme reports success (not missing), so that permitted viewers get
  a working page; only an identifier matching no record at all — never existed, or purged —
  reports the resource as missing.

**Address listing**

- The listing covers meme permalinks and the public static addresses minus those disallowed by
  FR-012 — in practice the home feed plus every publicly visible meme.
- Refresh interval defaults to **1 hour**. Memes are not time-critical content and crawlers do
  not re-fetch a listing more often than that in practice.
- Change-frequency and priority hints are deliberately omitted; major search engines ignore
  them.
- Publication date is the meme's creation date. Memes are immutable once uploaded, so there is
  no separate modification date to report.
- Paged feed addresses (`?after=` cursors) are excluded from the listing — they are traversal
  aids, not content, and FR-033 makes them canonicalise to the home feed.

**Delivery**

- The client-side application, its routing, and its data fetching are unchanged. This feature
  changes only what the **initial** response contains and what status it reports.
- Everyone receives the same response for the same address; there is no separate crawler path
  and no user-agent inspection, so there is no cloaking exposure and no second code path to
  keep in sync.
- Compression is applied at the point the site's own server emits responses, so it holds
  regardless of how the stack is reached.
- The derived metadata is cached per address for 1 hour and invalidated on any visibility
  transition (FR-039, FR-040), so a shared cache entry never outlives a moderation decision.
- A metadata failure degrades the response rather than failing it (FR-038): the shell always
  serves, so this feature cannot make the site less available than it is today.

**Out of scope**

- Server-side rendering of page *bodies*. Only the descriptive metadata and the status code
  are server-delivered; the visible content continues to render client-side.
- Comment content in metadata or in the address listing.
- Author or profile pages, meme categories, tags, or search — none exist yet.
- Analytics, search-console account setup, and submission of the address listing to search
  engines. Those are operational follow-ups, documented but not automated here.
- Internationalisation and alternate-language metadata; the site is English-only.
- Any change to the image variant pipeline. The large (1200px) variant already exists and is
  already published in the API's size list where the source image is large enough; this
  feature only *selects* from what is already generated.

**Dependencies**

- Relies on the existing public feed visibility rules, the existing image representation data,
  the existing YouTube link parsing and thumbnail resolution, and the existing not-found view.
- Relies on the site having exactly one canonical origin, which the current deployment already
  enforces.
