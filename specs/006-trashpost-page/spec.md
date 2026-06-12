# Feature Specification: Trashpost Page (Single Meme View)

**Feature Branch**: `006-trashpost-page`

**Created**: 2026-06-12

**Status**: Draft

**Input**: User description: "lets create trashpost page now"

## Overview

The trashpost page is the single-meme view of the site: every meme has its own
shareable permalink (`/posts/{hash}`, per its stable 10-char public code), and this
page is what that permalink shows. Feature 005 (mainpage) already links every feed
entry to its permalink but left the destination as a placeholder; this feature builds
the real destination. The page presents one meme — its title and its media (image or
embedded YouTube player) — inside the same site layout (header, navigation menu) as
the mainpage, fed by the existing single-post read API.

## Clarifications

### Session 2026-06-12

- Q: On the meme page, should the displayed image be interactive (e.g., link to the
  full-resolution original), or display-only? → A: Display-only — the image is purely
  presentational with no click behavior.
- Q: What should the meme image's alt text be, especially for untitled memes? → A:
  The meme's title when present; a fixed generic site-defined fallback (e.g., "Meme
  image") when untitled — always non-empty.
- Q: When a visitor opens a meme from a scrolled feed position, where should the
  meme page's scroll start? → A: At the top of the page, like a native page load;
  Back still restores the feed's prior scroll position.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View a single meme via its permalink (Priority: P1)

A visitor opens a meme's permalink — by selecting an entry in the home feed, by
following a link someone shared, or by typing/pasting the address — and sees that
meme rendered in full: its title and its media (the image at a size appropriate to
the screen, or a playable embedded YouTube player), inside the familiar site layout.

**Why this priority**: This is the entire purpose of the page and the missing half of
the share/permalink story: feature 005 already produces these links, but today they
lead nowhere. Without this story there is no feature.

**Independent Test**: Against a populated backend, open a known meme's permalink
directly in a fresh browser tab and confirm the meme's title and media render
correctly for both an image post and a YouTube post.

**Acceptance Scenarios**:

1. **Given** a visible meme with a known public code, **When** a visitor opens its
   permalink directly in a fresh tab, **Then** the page shows that meme's title and
   its media inside the standard site layout (header and navigation menu).
2. **Given** an image meme, **When** its page renders, **Then** the image is shown
   scaled to fit its container, preserving aspect ratio, at a size appropriate for
   the viewport.
3. **Given** a YouTube meme, **When** its page renders, **Then** a playable embedded
   YouTube player is shown, scaled to its container.
4. **Given** a visitor browsing the home feed, **When** they select a feed entry,
   **Then** they arrive on this page for that exact meme (no placeholder or
   not-found view).

---

### User Story 2 - Not-found and failure handling (Priority: P2)

A visitor who follows a dead or mistyped link — a code that never existed, or a meme
that has been hidden or removed — sees a clear "not found" view with a way back to
the home feed, rather than a blank page or a raw error. Temporary load failures are
distinguished from missing memes and offer a retry.

**Why this priority**: Shared links live forever; a meme site must handle stale links
gracefully. This protects the share story delivered by US1 but depends on US1
existing first.

**Independent Test**: Open a permalink with an unknown code and confirm a clear
not-found view with a working link back to the home feed; simulate a failed request
for a valid code and confirm an error state with a retry affordance is shown instead
of the not-found view.

**Acceptance Scenarios**:

1. **Given** a permalink whose code matches no visible meme (unknown, hidden, or
   removed), **When** a visitor opens it, **Then** the page shows a clear not-found
   message inside the site layout, with a link back to the home feed.
2. **Given** the meme request fails for a temporary reason (network/server error),
   **When** the page handles the failure, **Then** an error state with a retry
   affordance is shown, distinct from the not-found view, and retrying loads the
   meme without a full page reload.
3. **Given** the meme is still loading, **When** the visitor waits, **Then** a
   loading indication is shown rather than a blank content area or a premature
   not-found message.

---

### User Story 3 - Browser-native navigation between feed and meme (Priority: P2)

A visitor moves naturally between the feed and individual memes: selecting a meme,
pressing Back to return to their place in the feed, pressing Forward to come back to
the meme, refreshing the meme page, and bookmarking or sharing its address — all
behaving like a normal website.

**Why this priority**: Browser-native navigation is a constitutional requirement and
the glue between this page and the existing feed; it is what makes the permalink
genuinely shareable and the site pleasant to browse.

**Independent Test**: From a scrolled feed position, open a meme, press Back and
confirm the feed returns at the same scroll position; press Forward and confirm the
meme page returns; refresh the meme page and confirm the same meme renders.

**Acceptance Scenarios**:

1. **Given** a visitor has scrolled down the home feed and opened a meme, **When**
   they press the browser Back button, **Then** they return to the feed at their
   previous scroll position.
2. **Given** a visitor pressed Back to the feed, **When** they press Forward,
   **Then** the same meme page is restored.
3. **Given** a visitor on a meme page, **When** they refresh the browser, **Then**
   the same meme renders again from its address alone.
4. **Given** a meme page is open, **When** the visitor reads the browser tab/window
   title, **Then** it reflects that meme (e.g. includes the meme's title), so
   bookmarks and shared links are identifiable.
5. **Given** the navigation menu on a meme page, **When** the visitor selects
   "Home", **Then** they navigate to the home feed.
6. **Given** a visitor has scrolled down the home feed, **When** they open a meme,
   **Then** the meme page starts scrolled to the top.

---

### User Story 4 - Accessible, themed, responsive presentation (Priority: P3)

A visitor on any device — phone, tablet, or desktop — sees a meme page that adapts
to their screen, follows their light/dark system preference, and is operable with
assistive technology and by touch.

**Why this priority**: These are baseline, constitutionally required qualities that
apply to the whole page; they enhance the other stories rather than standing alone.

**Independent Test**: View a meme page at narrow (mobile), medium (tablet), and wide
(desktop) widths and confirm no horizontal scrolling, clipping, or overlap; toggle
the OS light/dark preference and confirm the theme follows; verify the image has
descriptive alternative text and all controls are reachable and labeled.

**Acceptance Scenarios**:

1. **Given** any viewport from a small phone width through a wide desktop width,
   **When** the meme page renders, **Then** the header, menu, title, and media
   reflow to fit with no horizontal scrolling, clipped content, or overlap; images
   and the embedded player scale within their container preserving aspect ratio.
2. **Given** the visitor's system is set to dark (or light) mode, **When** the page
   loads, **Then** its appearance follows that preference.
3. **Given** a visitor using a keyboard or screen reader, **When** they traverse the
   page, **Then** the meme image exposes descriptive alternative text, navigation
   and controls are reachable and labeled, and information is never conveyed by
   color alone.

---

### Edge Cases

- **Unknown / stale code**: A permalink whose code matches no visible meme shows the
  not-found view (with a path back to the feed), never a blank page or raw error.
- **Hidden or removed meme**: Treated exactly like unknown — the visitor cannot tell
  the difference, and no hidden content leaks.
- **Untitled meme**: A meme without a title still renders its media coherently, the
  browser tab title falls back to the site name, and the image's alt text falls back
  to the generic site-defined text.
- **Missing or broken media**: A meme whose image is unavailable or whose YouTube
  reference is unrecognized still renders its title and a graceful fallback rather
  than a broken element.
- **Image sizes**: Only image sizes the backend actually offers are requested; when
  several sizes exist, an appropriate one is chosen for the viewport rather than
  always the largest.
- **Slow load**: While the meme is being fetched, a loading indication is shown; the
  not-found view never flashes before the result is known.
- **Repeated retry**: Retrying after a failure does not duplicate content or leave
  stale error messaging on screen once the meme loads.
- **Navigating between memes**: Arriving at a second meme's address from a first
  (e.g. via Back/Forward) shows the second meme's content, never the first's
  leftovers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every visible meme MUST be viewable on its own page at its existing
  shareable permalink (`/posts/{hash}`), addressed by the meme's stable 10-character
  public code — the same address the home feed already links to.
- **FR-002**: The meme page MUST display the meme's title and its media, retrieved
  from the existing single-post read API by public code.
- **FR-003**: The meme page MUST render each supported media kind appropriately: a
  single image (scaled to its container, preserving aspect ratio) or an embedded
  playable YouTube player. The image is display-only — it MUST NOT be a link or
  carry any click behavior (no link to the original file, no zoom/lightbox).
  Multi-image galleries and uploaded-video playback are out of scope, matching the
  mainpage feature.
- **FR-004**: When more than one image size is available for the meme, the page MUST
  request an appropriately sized image for the viewport and MUST never request an
  image size the backend does not provide.
- **FR-005**: The meme page MUST use the same overall site layout as the mainpage —
  site header with wordmark and the fixed anonymous navigation menu ("Home",
  "Login/register") — with the meme as the main content.
- **FR-006**: When the requested code matches no visible meme (unknown, not
  activated, or removed), the page MUST show a clear not-found view inside the site
  layout, including a way back to the home feed. Hidden and unknown memes MUST be
  indistinguishable to the visitor.
- **FR-007**: The page MUST present distinct states for loading, load failure, and
  not-found. A temporary load failure MUST offer a retry affordance and MUST NOT be
  presented as not-found.
- **FR-008**: Browser Back, Forward, and Refresh MUST behave natively: Refresh
  re-renders the same meme from its address alone; Back from a meme returns to the
  previous view (in particular, the feed at its prior scroll position, as delivered
  by feature 005); Forward restores the meme page. Opening a meme page (e.g., from
  a scrolled feed) MUST start it scrolled to the top, like a native page load.
- **FR-009**: The browser tab/window title MUST identify the meme (using its title
  when present, falling back to the site name), so bookmarks and shared links are
  recognizable.
- **FR-010**: The layout MUST adapt fluidly across mobile, tablet, and desktop
  widths with no horizontal scrolling, clipped content, or overlapping elements;
  media (including the YouTube embed) MUST scale within its container preserving
  aspect ratio.
- **FR-011**: The page appearance MUST follow the visitor's `prefers-color-scheme`,
  consistent with the mainpage; a manual theme override remains out of scope.
- **FR-012**: The meme image MUST carry non-empty alternative text: the meme's
  title when present, otherwise a fixed generic site-defined fallback (e.g., "Meme
  image"). Interactive controls and navigation MUST be labeled and reachable, and
  information MUST NOT be conveyed by color alone.
- **FR-013**: A meme lacking a title or lacking usable media MUST still render
  coherently (graceful fallback), never as a broken element or blank page.

### Key Entities *(include if feature involves data)*

- **Meme (single post)**: One item as returned by the single-post read API,
  addressed by its stable public code. Relevant attributes for display: public code,
  title, media kind, available image sizes (with widths), a default/preferred image,
  and any YouTube reference. The public code — never a database id — is the handle
  used in the address.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of visible memes' permalinks, opened directly in a fresh tab,
  render that meme's title and media within 2 seconds on a typical broadband
  connection.
- **SC-002**: 100% of permalinks with unknown, hidden, or removed codes show the
  not-found view with a working route back to the home feed — never a blank page,
  raw error, or leaked hidden content.
- **SC-003**: In 100% of tested navigation sequences, Back from a meme page returns
  to the previous view (including the feed at its prior scroll position), Forward
  restores the meme page, and Refresh re-renders the same meme.
- **SC-004**: Selecting any entry in the home feed lands on the correct meme's page
  (matching code and content) in 100% of attempts.
- **SC-005**: The page renders with no horizontal scrolling, clipping, or overlap at
  representative mobile, tablet, and desktop widths (roughly 320px through wide
  desktop), with media scaled within its container.
- **SC-006**: The page's light/dark appearance matches the system preference on
  first load and updates if the preference changes.
- **SC-007**: Every meme image on the page has non-empty descriptive alternative
  text, and all interactive controls are reachable and operable by keyboard and by
  touch.
- **SC-008**: Loading, failure (with retry), and not-found states are each reachable
  and visibly distinct; a simulated failure followed by a successful retry leaves
  the meme correctly displayed with no stale error messaging.

## Assumptions

- The single-post read API from feature 004 is the data source: `GET
  /api/posts/{hash}` returns one visible post (title, `youtube`, image
  `sizes`/`default`/`original`, public `hash`, permalink `url`) or 404 for unknown,
  not-activated, or soft-deleted posts. No backend changes are assumed.
- The page lives in the already-scaffolded React 18 + Vite (TypeScript) frontend and
  replaces the placeholder destination that feature 005 left behind the feed's
  `/posts/{hash}` links; the mainpage's existing layout (header, menu), theming, and
  media-rendering behavior are reused for consistency. No new runtime dependency is
  assumed without separate approval per the constitution's Minimal Dependencies
  principle.
- Supported media kinds match the mainpage feature's clarified scope: a single image
  with responsive sizes, or a YouTube embed. Multi-image galleries and uploaded
  video playback remain deferred.
- The page is public and read-only: comments, voting/sharing controls, editing,
  uploading, related/next-previous meme navigation, and any logged-in/account state
  are out of scope. The navigation menu stays the fixed anonymous menu from
  feature 005.
- The earlier prototype's single-post page (`TrashPostPage` rendering one post in
  "full" mode at `/posts/{hash}`) is the informal reference for what this page shows;
  where it conflicts with the constitution or this spec, the latter win.

## Out of Scope

- Comments, voting, sharing buttons, and view counters.
- Next/previous or related-meme navigation on the meme page.
- Authentication, account state, uploading, editing, or deleting memes.
- Multi-image galleries and uploaded-video playback (deferred, as in feature 005).
- Backend/API changes — the existing single-post endpoint is consumed as-is.
- A manual light/dark theme override (deferred, as in feature 005).

## Dependencies

- Feature 004 (read-side feed API): the single-post endpoint
  `GET /api/posts/{hash}` and its post payload (title, media, image sizes, hash).
- Feature 005 (frontend mainpage): the site layout (header, navigation menu),
  theming, media-rendering behavior, the feed's `/posts/{hash}` entry links, and
  feed scroll restoration on Back.
