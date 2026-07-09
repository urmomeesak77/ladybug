# Feature Specification: Admin Meme Moderation Table

**Feature Branch**: `010-admin-meme-moderation`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "lets create dedicated page for admin(and higher user) to see compact view of uploaded meme contents. it should be in form of table, max 100 per page (use pagination with dedicated links), newer ones first. Row content: 1. thumbnail (max 100x75px, hide overflow; images use dir 100; YouTube gets a downloaded thumbnail stored in a dedicated dir + SQL field). 2. user (User.username if user_id resolves, else the row's username). 3. created datetime. 4. activated. 5. deleted. 6. action buttons: Activate, soft Delete. Row is clickable and opens that meme's page."

## Clarifications

### Session 2026-07-09

- Q: When is a YouTube meme's one-time thumbnail download triggered? → A: Lazy on render — the first time a YouTube meme lacking a stored thumbnail appears in the moderation table, the server fetches and stores it synchronously (placeholder on failure); no queue infrastructure is introduced.
- Q: Do the row actions require a confirmation step before applying? → A: Only Delete requires a lightweight confirmation; Activate, Deactivate, and Restore apply on a single click.
- Q: How do admins reach the moderation page? → A: A role-gated link in the existing site navigation, shown only to admin/superuser and hidden from guests/members (in addition to the page's own shareable URL).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse all memes in a moderation table (Priority: P1)

An admin (or higher-ranked user) opens a dedicated moderation page and sees a compact
table of every uploaded meme, newest first, 100 rows per page. Each row shows a small
thumbnail, the uploader, when it was created, whether it is activated, and whether it is
deleted. The admin can move between pages using numbered/dedicated page links, and each
page is a real, bookmarkable, refresh-safe URL. Clicking a row opens that meme's own page.

**Why this priority**: This is the core of the feature — without the table view there is
nothing to moderate. It delivers standalone value (visibility into all content, including
content the public feed hides) even before any action buttons exist.

**Independent Test**: Sign in as an admin, open the moderation page, and confirm the table
lists memes newest-first, 100 per page, with all six columns populated, working page
links reflected in the URL, and that clicking a row navigates to the correct meme page.

**Acceptance Scenarios**:

1. **Given** an admin is signed in and memes exist, **When** they open the moderation page,
   **Then** they see a table of up to 100 memes ordered newest-first with columns
   thumbnail, user, created, activated, deleted, and actions.
2. **Given** more than 100 memes exist, **When** the admin uses the dedicated page links,
   **Then** the URL reflects the selected page and the table shows that page's 100 memes.
3. **Given** the admin is on a specific page, **When** they refresh or share the URL,
   **Then** the same page of results is restored.
4. **Given** any row in the table, **When** the admin clicks the row (outside the action
   buttons), **Then** that meme's own page opens.
5. **Given** a meme with no resolvable owning account, **When** the row renders,
   **Then** the user column shows the row's stored uploader name.
6. **Given** a meme whose `user_id` resolves to an existing account, **When** the row
   renders, **Then** the user column shows that account's username.

---

### User Story 2 - Restrict the page to admins and above (Priority: P1)

Only users ranked admin or higher may reach the moderation page or its underlying data.
Guests and ordinary members are denied and never see meme moderation controls or data.

**Why this priority**: The page exposes hidden, deleted, and unactivated content plus
destructive actions; unauthorized access is a security failure. This gate must exist
before the table is exposed to any real traffic.

**Independent Test**: Attempt to reach the moderation page and its data as a guest, as a
member, as an admin, and as a superuser; confirm only admin and superuser succeed and the
lower roles are refused.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they request the moderation page or its data,
   **Then** access is refused.
2. **Given** a signed-in member, **When** they request the moderation page or its data,
   **Then** access is refused.
3. **Given** a signed-in admin or superuser, **When** they request the moderation page,
   **Then** they are allowed in and the table loads.
4. **Given** the site navigation, **When** it renders for a guest or member,
   **Then** no moderation link is shown; **When** it renders for an admin or superuser,
   **Then** the moderation link is shown.

---

### User Story 3 - Toggle a meme's activation from the table (Priority: P2)

From a row, an admin can activate a not-yet-activated meme or deactivate an activated one.
After the action, the row reflects the new activated state without losing the admin's place
in the table.

**Why this priority**: Activation is the primary moderation action that lets held content
become publicly visible, and reversibility (deactivate) lets admins pull content back;
high value but depends on the table (US1) existing first.

**Independent Test**: As an admin, activate a not-yet-activated meme and confirm it becomes
activated; then deactivate it and confirm it returns to not-activated — with the row's
activated column updating each time.

**Acceptance Scenarios**:

1. **Given** a not-yet-activated meme, **When** the admin uses its Activate action,
   **Then** the meme becomes activated and the row shows it as activated.
2. **Given** an activated meme, **When** the admin uses its Deactivate action,
   **Then** the meme returns to not-activated and the row shows it as not activated.
3. **Given** any row, **When** it renders, **Then** it offers exactly the applicable
   control for its state (Activate when inactive, Deactivate when activated).
4. **Given** the admin toggles activation on a meme on page N, **When** the action
   completes, **Then** they remain on page N.

---

### User Story 4 - Soft-delete or restore a meme from the table (Priority: P2)

From a row, an admin can soft-delete a meme (removed from public visibility but retained in
storage) or restore a previously soft-deleted meme. The row reflects the deleted state.

**Why this priority**: Removing abusive or unwanted content is a core moderation duty, and
reversible (soft) deletion with restore avoids irreversible data loss. Depends on US1.

**Independent Test**: As an admin, delete a meme and confirm it is flagged deleted (retained,
not purged) and absent from public views; then restore it and confirm it returns to the
non-deleted state.

**Acceptance Scenarios**:

1. **Given** a meme that is not deleted, **When** the admin uses its Delete action,
   **Then** the meme is soft-deleted (retained but flagged) and the row shows it as deleted.
2. **Given** a soft-deleted meme, **When** the admin uses its Restore action,
   **Then** the meme returns to the non-deleted state and the row shows it as not deleted.
3. **Given** a soft-deleted meme, **When** any public-facing view is checked,
   **Then** the meme does not appear there.
4. **Given** any row, **When** it renders, **Then** it offers exactly the applicable
   control for its state (Delete when not deleted, Restore when deleted).
5. **Given** the admin deletes or restores a meme on page N, **When** the action completes,
   **Then** they remain on page N.

---

### Edge Cases

- **Empty state**: No memes exist — the page shows an explicit "no entries" state rather
  than a blank table.
- **Out-of-range page**: A page number beyond the last page shows an empty/last-page state
  rather than an error.
- **Missing image variant**: The `100`-size image for a meme is missing — the thumbnail
  cell shows a graceful placeholder rather than a broken image.
- **YouTube thumbnail unavailable**: The remote thumbnail cannot be downloaded (network
  error, removed video) — the cell shows a placeholder and the failure does not block the
  rest of the table.
- **Non-image, non-YouTube or malformed media**: The thumbnail cell degrades to a
  placeholder.
- **Oversized thumbnail source**: Source art larger than 100×75 is clipped to the cell
  without distorting the layout or overflowing the row.
- **Row click vs. action click**: Clicking an action button must NOT also trigger the
  row's navigate-to-meme behavior.
- **Concurrent moderation**: Two admins act on the same meme nearly simultaneously — the
  second action reflects the already-changed state without error.
- **Already-deleted meme**: Its state is shown as deleted and its deletion control offers
  Restore; its activation control still reflects its activated state (Activate/Deactivate)
  per FR-016.
- **Repeated toggles**: Activating then deactivating (or deleting then restoring) the same
  meme returns it cleanly to the prior state with no residual or duplicate effect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a dedicated moderation page, reachable at its own
  shareable URL, that lists uploaded memes in a table.
- **FR-001a**: The system MUST expose a link to the moderation page within the existing
  site navigation, visible only to users ranked admin or higher; guests and members MUST
  NOT see this link. (The link is a discoverability aid; the URL itself remains directly
  reachable and role-gated per FR-002.)
- **FR-002**: Access to the moderation page and the data behind it MUST be restricted to
  users ranked **admin or higher** (admin, superuser); guests and members MUST be refused.
- **FR-003**: The table MUST order memes newest-first by creation time.
- **FR-004**: The table MUST show at most 100 memes per page.
- **FR-005**: Pagination MUST use dedicated page links, and the selected page MUST be
  reflected in the URL so it is bookmarkable and refresh-safe (Back/Forward/Refresh restore
  the same page).
- **FR-006**: The moderation table MUST include memes regardless of their activated or
  deleted state (i.e., it also surfaces content hidden from public views), so admins can
  review everything. (See Assumptions.)
- **FR-007**: Each row MUST display these columns in order: (1) thumbnail, (2) user,
  (3) created datetime, (4) activated, (5) deleted, (6) action buttons.
- **FR-008**: The thumbnail MUST be constrained to a maximum of 100×75 px, with any content
  exceeding that box hidden/clipped rather than overflowing the cell.
- **FR-009**: For image memes, the thumbnail MUST use the meme's existing `100`-size image
  variant.
- **FR-010**: For YouTube memes, the system MUST obtain a thumbnail image for the video,
  download it **once**, and store it in a dedicated thumbnail location; a dedicated stored
  field MUST record that thumbnail so it is not re-downloaded on subsequent views. The
  download MUST be triggered lazily: the first time a YouTube meme lacking a stored
  thumbnail appears in the moderation table, the server fetches and stores it synchronously
  during that request (placeholder per FR-011 on failure). No queue/async infrastructure is
  introduced.
- **FR-011**: When a usable thumbnail cannot be produced (missing variant, failed download,
  unsupported media), the thumbnail cell MUST show a graceful placeholder without breaking
  the row or the rest of the table.
- **FR-012**: The user column MUST show the owning account's username when the meme's
  `user_id` resolves to an existing account; otherwise it MUST show the meme row's stored
  uploader name.
- **FR-013**: The created column MUST display the meme's creation date and time.
- **FR-014**: The activated column MUST clearly indicate whether the meme is activated, and
  the deleted column MUST clearly indicate whether the meme is deleted — using more than
  color alone.
- **FR-015**: Each row MUST offer a reversible activation control and a reversible soft
  deletion control, presented according to the row's current state (FR-016).
- **FR-016**: Both moderation actions MUST be reversible from this page:
  - Activation: a not-yet-activated meme MUST offer **Activate**; an activated meme MUST
    offer **Deactivate**, which returns it to the not-activated state.
  - Deletion: a non-deleted meme MUST offer **Delete** (soft-delete: retain data, flag as
    deleted, remove from public views); a deleted meme MUST offer **Restore**, which
    returns it to the non-deleted state. **Delete** MUST require a lightweight confirmation
    step before it applies; **Activate**, **Deactivate**, and **Restore** apply on a single
    click without confirmation.
  Each control MUST reflect the row's current state so the admin always sees the action
  that applies.
- **FR-017**: After any moderation action (Activate, Deactivate, Delete, Restore), the admin
  MUST remain on the same page of the table, and the affected row MUST reflect the new state.
- **FR-018**: Clicking a row (outside the action buttons) MUST open that meme's own page;
  clicking an action button MUST NOT also trigger row navigation.
- **FR-019**: The page MUST render an explicit empty state when there are no memes to show.
- **FR-020**: The page MUST be themed (light/dark per user preference), accessible
  (labeled controls, appropriate roles/labels on table and actions), and responsive across
  mobile, tablet, and desktop without horizontal overflow.

### Key Entities *(include if feature involves data)*

- **Meme (Trashpost)**: An uploaded entry. Relevant attributes for this feature: stable
  public code (used in its page URL and row navigation), media type, image reference,
  YouTube reference, owning-account reference (may be absent), stored uploader name,
  creation time, activated state, deleted state, and (new) a stored YouTube-thumbnail
  reference.
- **User / Account**: The owner a meme may be linked to; carries a username and a role.
  Role determines who may access the moderation page (admin or higher).
- **YouTube thumbnail**: A locally stored image for a YouTube meme, fetched once from the
  remote source and reused thereafter, referenced by a dedicated stored field on the meme.
- **Moderation page view**: A paginated, newest-first projection of memes (100 per page)
  with per-row moderation actions, available only to admins and above.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can locate the moderation page and see the first page of memes,
  newest-first, within a few seconds of opening it.
- **SC-002**: 100% of moderation-page access attempts by guests and members are refused;
  100% of attempts by admins and superusers succeed.
- **SC-003**: Every row shows a thumbnail or a graceful placeholder — there are no broken
  images — for both image and YouTube memes.
- **SC-004**: Each YouTube thumbnail is fetched from the remote source at most once; repeat
  views and reloads reuse the stored image (no repeat downloads).
- **SC-005**: An admin can activate, deactivate, soft-delete, or restore a meme and see the
  row's state update without losing their current page, in a single action per row.
- **SC-006**: Clicking any row opens the correct meme's page for 100% of rows.
- **SC-007**: Page navigation is fully bookmarkable and refresh-safe: reloading or sharing a
  page URL restores exactly that page of results.
- **SC-008**: The page presents without horizontal scrolling or clipped controls across
  mobile, tablet, and desktop widths, in both light and dark themes.

## Assumptions

- **"Admin and higher"** maps to the existing role order (guest < member < admin <
  superuser); admin and superuser are allowed, guest and member are refused.
- The moderation table **includes memes of every state** (activated or not, deleted or not),
  because a moderation console whose purpose is oversight — and which shows explicit
  "activated" and "deleted" columns — must surface content hidden from public views. If the
  intent was to list only non-deleted or only activated memes, this assumption must be
  revised.
- Pagination is **page-based with numbered/dedicated links** (not infinite scroll); this is
  a back-office table, distinct from the public feed's scroll-then-"Load more" model.
- The **YouTube thumbnail** is a standard still image for the video (default/medium
  resolution is sufficient at 100×75), stored under the media storage tree in a dedicated
  thumbnails subtree, and recorded via a new stored field on the meme. Adding this field is
  a schema change via the normal migration path.
- **Soft delete** means the existing recoverable-deletion mechanism (flag + retain), not a
  hard purge of the row or its media; **Restore** reverses it. Both activation and deletion
  are fully reversible from this page (Activate↔Deactivate, Delete↔Restore).
- The page reuses the existing site layout, theming, accessibility, and responsive
  behavior established by prior features; no new third-party dependency is assumed.
- Activation/deletion actions are performed by an authenticated admin session; the same
  admin-or-higher gate applies to the actions as to viewing the page.
