# Feature Specification: Frontend Mainpage (Home Feed)

**Feature Branch**: `005-frontend-mainpage`

**Created**: 2026-06-09

**Status**: Draft

**Input**: User description: "lets create a plan to implement frontend mainpage. check images in doc folder/"

## Clarifications

### Session 2026-06-09

- Q: Which media kinds must the mainpage feed render? → A: Single image (responsive sizes) + YouTube embed only, matching the 004 feed API; multi-image galleries and uploaded-video playback are deferred to a later feature.
- Q: Manual light/dark theme toggle in this feature? → A: No — follow `prefers-color-scheme` only; a manual override toggle is deferred to future development.
- Q: Does the mainpage navigation menu reflect logged-in/auth state? → A: No — fixed anonymous menu ("Home", "Login/register"); account/logout state is out of scope for this feature.
- Q: What does selecting a feed entry link to, given the single-meme page is out of scope? → A: A real `/posts/{hash}` permalink link now; the destination detail page is built in a later feature (placeholder/not-found until then).

## User Scenarios & Testing *(mandatory)*

The mainpage is the home/landing view of the meme-sharing site. A visitor arrives
and is presented with the site header, a navigation menu, and an endless feed of the
newest memes (image, multi-image, video, and YouTube-link entries). The layout mirrors
the reference screenshot `docs/mainpage.png`: a centered site wordmark at the top, a
left-hand navigation menu ("Home", "Login/register"), and a vertically stacked feed of
titled entries in the main content area.

### User Story 1 - Browse the endless meme feed (Priority: P1)

A visitor opens the site's home page and immediately sees the newest memes, each shown
with its title and its media (an image, or an embedded YouTube player). As they scroll
toward the bottom, the next batch of memes loads automatically and appends to the feed,
letting them browse continuously without clicking.

**Why this priority**: This is the core purpose of the site and the reason a visitor
lands on the mainpage. Without it there is no product. It is independently valuable and
demonstrable on its own.

**Independent Test**: Load the home page against a populated backend and confirm the
first batch of newest memes renders with titles and correctly displayed media; scroll
to the bottom and confirm the next batch appends in newest-first order with no
duplicates and no gaps.

**Acceptance Scenarios**:

1. **Given** the backend has more memes than fit in one batch, **When** the visitor
   opens the home page, **Then** the first batch of the newest memes is displayed
   newest-first, each with its title and its media.
2. **Given** the visitor has scrolled to the bottom of the loaded feed, **When** more
   memes are available, **Then** the next batch loads automatically and is appended
   below the current entries without reloading the page or losing scroll position.
3. **Given** a meme entry is an image post, **When** it renders, **Then** the image is
   shown scaled to fit its container while preserving aspect ratio; **And** a YouTube
   post renders as a playable embedded player.
4. **Given** the visitor has continuously scrolled through a large run of memes, **When**
   a defined batch limit of entries has been auto-loaded on the current page, **Then**
   automatic loading pauses and an explicit "Load more" control is offered to advance.

---

### User Story 2 - Shareable, refresh-safe navigation (Priority: P2)

A visitor can bookmark or share the address of what they are viewing, use the browser
Back/Forward/Refresh buttons without losing their place, open an individual meme from
the feed by following its permalink, and move between the menu destinations ("Home",
"Login/register").

**Why this priority**: Predictable, shareable navigation is a hard project requirement
and what distinguishes a real content site from a brittle single-page app. It builds
directly on the feed from US1.

**Independent Test**: Advance through feed pages, copy the address, open it in a fresh
tab, and confirm the same feed page is restored; use Back/Forward/Refresh and confirm
the view and position are restored; click a meme and confirm it navigates to that
meme's own permalink address.

**Acceptance Scenarios**:

1. **Given** the visitor has advanced past the first page of the feed via "Load more",
   **When** they copy the current address and open it in a new tab (or refresh),
   **Then** the same feed page is restored rather than resetting to the newest entries.
2. **Given** the visitor navigates to a feed page and then presses the browser Back
   button, **When** the previous view loads, **Then** the prior feed page and scroll
   context are restored.
3. **Given** a meme entry in the feed, **When** the visitor selects it, **Then** the
   browser navigates to that meme's own shareable permalink address (its stable public
   code).
4. **Given** the navigation menu, **When** the visitor selects "Home", **Then** the feed
   home view is shown; **And** selecting "Login/register" navigates to the
   login/registration destination.

---

### User Story 3 - Accessible, themed, responsive presentation (Priority: P3)

A visitor on any device — phone, tablet, or desktop — sees a layout that adapts to their
screen, follows their light/dark system preference, and is operable with assistive
technology and by touch.

**Why this priority**: These are baseline quality and accessibility requirements that
apply across the whole page. They enhance US1/US2 rather than standing alone, so they
come last while still being mandatory.

**Independent Test**: View the mainpage at narrow (mobile), medium (tablet), and wide
(desktop) widths and confirm there is no horizontal scrolling, clipping, or overlap;
toggle the OS light/dark preference and confirm the theme follows it; verify images have
descriptive alternative text and interactive controls are reachable and labeled.

**Acceptance Scenarios**:

1. **Given** any viewport from a small phone width up through a wide desktop width,
   **When** the mainpage renders, **Then** the header, menu, and feed reflow to fit with
   no horizontal scrolling, clipped content, or overlapping elements.
2. **Given** the visitor's system is set to dark (or light) mode, **When** the mainpage
   loads, **Then** its appearance follows that preference.
3. **Given** a visitor using a keyboard or screen reader, **When** they traverse the
   page, **Then** every image exposes descriptive alternative text, navigation and
   controls are reachable and labeled, and information is never conveyed by color alone.

---

### Edge Cases

- **Empty feed**: When the backend returns no memes, the mainpage shows a clear empty
  state rather than a blank page or an error.
- **End of feed**: When no further memes are available, automatic loading stops and the
  visitor is informed they have reached the end (no endless spinner).
- **Slow / in-flight loads**: While a batch is loading, a loading indication is shown;
  rapid scrolling does not trigger duplicate or overlapping batch requests.
- **Failed load**: When a batch request fails (network/server error), an error state with
  a retry affordance is shown without discarding memes already displayed.
- **Missing or broken media**: A meme whose image is unavailable or whose YouTube link is
  unrecognized still renders its title and a graceful fallback rather than a broken
  element.
- **Posts with no title / link-only posts**: Entries lacking a title or lacking an image
  still render coherently.
- **Stale deep link**: Opening a feed-page address whose cursor no longer resolves falls
  back to the newest page rather than erroring.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mainpage MUST present a site header with the site wordmark, a fixed
  anonymous navigation menu offering "Home" and "Login/register", and a main content area
  containing the meme feed, consistent with `docs/mainpage.png`. The menu does not reflect
  logged-in/account/logout state in this feature.
- **FR-002**: The feed MUST display the newest memes first, retrieved from the read-side
  feed API, each entry showing its title and its associated media.
- **FR-003**: The feed MUST load a bounded batch of entries at a time (10) and MUST
  automatically load and append the next batch as the visitor scrolls toward the end.
- **FR-004**: After a defined number of auto-loaded entries on a page (200), the feed MUST
  stop auto-loading and present an explicit "Load more" control that advances to the next
  page.
- **FR-005**: Feed pagination state MUST be reflected in the page address so the current
  feed page is bookmarkable, shareable, and restored on refresh.
- **FR-006**: Browser Back, Forward, and Refresh MUST restore the correct feed view (the
  page identified by the URL cursor). Back/Forward MUST restore scroll context via the
  browser's native scroll restoration; Refresh restores the current page's first batch at
  the top of the feed (it does not replay previously auto-loaded batches).
- **FR-007**: Each meme entry MUST be a real link to that meme's own shareable permalink
  (`/posts/{hash}`) based on its stable public code, and selecting an entry MUST navigate
  to that permalink. The destination single-meme page itself is out of scope for this
  feature; until it is built, that route may show a placeholder or not-found view.
- **FR-008**: The mainpage MUST render each supported media kind appropriately: a single
  image and an embedded YouTube player; images MUST scale within their container
  preserving aspect ratio. Multi-image galleries and uploaded-video playback are out of
  scope for this feature.
- **FR-009**: When more than one image size is available for a meme, the page MUST request
  an appropriately sized image for the viewport rather than always the largest, and MUST
  never request an image size the backend does not provide.
- **FR-010**: The layout MUST adapt fluidly across mobile, tablet, and desktop widths with
  no horizontal scrolling, clipped content, or overlapping elements.
- **FR-011**: The page appearance MUST follow the visitor's `prefers-color-scheme`. A
  manual light/dark override is out of scope for this feature (deferred to future
  development).
- **FR-012**: All images MUST carry descriptive alternative text, interactive controls and
  navigation MUST be labeled and reachable, and information MUST NOT be conveyed by color
  alone.
- **FR-013**: The mainpage MUST present distinct, clear states for loading, empty feed,
  end-of-feed, and load failure (with retry), without discarding already-displayed memes
  on failure.
- **FR-014**: The feed MUST not display non-visible memes (the backend already excludes
  unpublished/removed entries; the page MUST render only what the API returns).
- **FR-015**: Concurrent/rapid scroll MUST NOT cause duplicate batch requests or duplicate
  entries in the feed.

### Key Entities *(include if feature involves data)*

- **Meme (feed entry)**: A single item in the feed as returned by the read-side feed API.
  Relevant attributes for display: stable public code (for the permalink), title, media
  kind, available image sizes (with widths), a default/preferred image, and any
  YouTube reference. The public code — not any database id — is the handle used in
  addresses.
- **Feed page**: A bounded, ordered slice of the newest-first meme list, advanced by a
  cursor. The current feed page is reflected in the page address.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a populated backend, a first-time visitor sees the newest memes
  rendered with titles and media within 2 seconds of the home page loading on a typical
  broadband connection.
- **SC-002**: A visitor can scroll through at least 200 memes in one page session, with
  each new batch appearing automatically as they reach the end, and with no duplicated or
  skipped entries across the whole run.
- **SC-003**: 100% of feed-page addresses, when copied to a new tab or refreshed, restore
  the same feed page rather than resetting to the newest entries.
- **SC-004**: Browser Back, Forward, and Refresh restore the correct feed page (the URL
  cursor) in 100% of tested navigation sequences; Back/Forward additionally restore scroll
  position via native browser scroll restoration, while Refresh restores that page's first
  batch at the top.
- **SC-005**: The mainpage renders with no horizontal scrolling, clipping, or overlap at
  representative mobile, tablet, and desktop widths (roughly 320px through wide desktop).
- **SC-006**: The page's light/dark appearance matches the system preference on first load
  and updates if the system preference changes.
- **SC-007**: Every image in the feed has non-empty descriptive alternative text, and all
  interactive controls are reachable and operable by keyboard and by touch.
- **SC-008**: Loading, empty, end-of-feed, and error states are each reachable and visibly
  distinct; a simulated batch failure shows a retry affordance while keeping previously
  loaded memes on screen.

## Assumptions

- The read-side feed API (feature 004) is the data source: `GET /api/posts` returns the
  newest visible posts as `{ "data": [ <Post> ] }`, supports a `limit` (default 10,
  clamped to 50) and a keyset `start` cursor (the previous batch's last `hash`), and each
  `<Post>` already carries `title`, `youtube`, image `sizes`/`default`/`original`, the
  public `hash`, and a frontend permalink `url` of the form `/posts/{hash}`.
- The frontend stack is the already-scaffolded React 18 + Vite (TypeScript) app under
  `frontend/`, using React Router for client-side routing; no new runtime dependency is
  assumed without separate approval per the constitution's Minimal Dependencies principle.
- The "200 entries then Load more" page break and the "10 per batch" size are taken from
  the constitution and the feed API; "page" in the address is expressed via the API's
  cursor mechanism rather than numeric offsets.
- The single meme detail page, authentication/login/registration flows, account pages,
  uploading, and commenting are **out of scope** for this feature; the mainpage only links
  out to those destinations (e.g., the meme permalink and the "Login/register" menu item).
  Because authentication is not built yet, the menu is a fixed anonymous menu with no
  logged-in/account/logout state.
- The reference screenshots in `docs/` (`mainpage.png`, `login.png`, `signup.png`) define
  the intended look and the menu structure; the literal prototype wordmark
  ("-{online-trash}-") is illustrative, and the site's own wordmark/text is used.
- Theming: the page follows the system `prefers-color-scheme`; a manual light/dark toggle
  and its persistence are out of scope for this feature and planned for future development.
