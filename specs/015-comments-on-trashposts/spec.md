# Feature Specification: Trashpost Comments

**Feature Branch**: `015-comments-on-trashposts`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "lets create a possibility to add comments to trshposts. only logged in users can add. admins can hide/delete them. show newest on top"

## Clarifications

### Session 2026-07-23

- Q: Who exactly may post a comment — any signed-in account, or must the e-mail be verified (matching the upload gate)? → A: Verified e-mail required — commenting uses the same gate as uploading (008): signed in **and** e-mail verified; unverified accounts see a "verify your e-mail to comment" prompt.
- Q: When a trashpost is permanently purged (hard-deleted), what happens to its comments? → A: Cascade-delete — the trashpost's comments are removed with it. (Soft-delete/hide of a trashpost does not delete its comments; they simply become unreachable through public views.)
- Q: What maximum length should a single comment allow? → A: 1000 characters.
- Q: How should a trashpost's comments load? → A: Newest-first in batches — an initial batch of 10 with a "load more older comments" control; batch position is **not** reflected in the URL (comments are a sub-section of the already-shareable post page).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read comments on a trashpost (Priority: P1)

Anyone viewing a trashpost's page — signed in or not — sees the comments other users
have left on it, with the most recent comment at the top. Each comment shows who wrote it
and when. If there are no comments yet, the page shows an explicit "no comments yet" state
rather than an empty gap.

**Why this priority**: Comments have no value if they cannot be read. Reading is the most
common interaction (every viewer sees them; only some write), works for the whole audience
including logged-out visitors, and is a complete, demonstrable slice on its own even before
anyone can post.

**Independent Test**: Open a trashpost page that already has comments (as a signed-out
visitor and as a signed-in user) and confirm the comments render newest-first, each with
its author name and timestamp, and that a post with no comments shows the empty state.

**Acceptance Scenarios**:

1. **Given** a trashpost with several comments, **When** any visitor opens its page,
   **Then** the comments are listed with the newest comment first and the oldest last.
2. **Given** a comment, **When** it is displayed, **Then** it shows the commenter's name,
   the comment text, and when it was posted.
3. **Given** a trashpost with no comments, **When** any visitor opens its page,
   **Then** an explicit "no comments yet" state is shown instead of a blank area.
4. **Given** a trashpost page, **When** it renders, **Then** the number of comments on that
   trashpost is shown.

---

### User Story 2 - Add a comment as a verified signed-in user (Priority: P1)

A signed-in user with a verified e-mail reading a trashpost writes a comment and submits
it. The comment appears immediately at the top of that trashpost's comment list, attributed
to them, without a full page reload and without losing their place on the page. Signed-out
visitors do not get the comment form; instead they are shown a prompt to sign in. Signed-in
users who have not yet verified their e-mail are shown a prompt to verify it, not the form.

**Why this priority**: Adding comments is the core purpose of the feature. Together with
reading (US1) it forms the minimum viable product; the moderation stories build on top of
the content this story creates.

**Independent Test**: Sign in with a verified account, open a trashpost, submit a comment,
and confirm it appears at the top of the list attributed to your account; then sign out,
reload the page, and confirm the comment form is replaced by a sign-in prompt and no comment
can be submitted; then sign in with an unverified account and confirm a verify-e-mail prompt
appears instead of the form.

**Acceptance Scenarios**:

1. **Given** a signed-in user with a verified e-mail on a trashpost page, **When** they type
   a comment and submit it, **Then** the comment is saved and appears at the top of that
   trashpost's comment list attributed to them.
2. **Given** a signed-out visitor on a trashpost page, **When** the page renders, **Then**
   no comment-entry form is available and a prompt to sign in is shown in its place.
3. **Given** a signed-in user whose e-mail is not verified, **When** the page renders,
   **Then** no comment-entry form is available and a prompt to verify their e-mail is shown
   in its place.
4. **Given** a signed-out visitor or an unverified signed-in user, **When** they attempt to
   submit a comment directly (bypassing the UI), **Then** the request is refused and no
   comment is created.
5. **Given** a verified signed-in user, **When** they submit an empty or whitespace-only
   comment, **Then** it is rejected with a clear validation message and nothing is saved.
6. **Given** a verified signed-in user, **When** they submit a comment longer than 1000
   characters, **Then** it is rejected with a clear validation message and nothing is saved.
7. **Given** a verified signed-in user submitting a comment, **When** the comment text
   contains characters that could be interpreted as markup, **Then** the text is stored and
   later displayed as literal text, never executed or rendered as markup.

---

### User Story 3 - Admin hides or unhides a comment (Priority: P2)

An admin (or higher-ranked user) viewing a trashpost sees a moderation control on each
comment. They can hide a comment that violates the rules; a hidden comment is removed from
what ordinary visitors see but is retained and still visible to admins, marked as hidden.
The admin can later unhide it to restore it to public view.

**Why this priority**: Hiding is the primary, reversible moderation tool — it removes
offensive content from the public without destroying it, so mistakes can be undone. It is
high value but depends on comments (US1/US2) existing first.

**Independent Test**: As an admin, hide a comment and confirm ordinary visitors no longer
see it while admins still see it flagged as hidden; then unhide it and confirm it returns
to public view for everyone.

**Acceptance Scenarios**:

1. **Given** a visible comment, **When** an admin hides it, **Then** ordinary visitors
   (guests and members) no longer see it on the trashpost page.
2. **Given** a hidden comment, **When** an admin views the trashpost, **Then** the comment
   is still shown to the admin, clearly marked as hidden (by more than color alone), with
   an option to unhide it.
3. **Given** a hidden comment, **When** an admin unhides it, **Then** it becomes visible to
   all visitors again.
4. **Given** a signed-in member (non-admin), **When** they view a trashpost, **Then** they
   see no hide/unhide control on any comment.
5. **Given** an admin hides or unhides a comment, **When** the action completes, **Then**
   the comment list reflects the new state without the admin losing their place on the page.
6. **Given** the count of comments shown to the public, **When** a comment is hidden,
   **Then** hidden comments are not counted in the public comment count.

---

### User Story 4 - Admin permanently deletes a comment (Priority: P2)

An admin (or higher-ranked user) can permanently delete a comment that should not be
retained at all. Deletion is irreversible and, because of that, is confirmed before it
takes effect. Once deleted, the comment is gone for everyone, including admins.

**Why this priority**: Some content (illegal, doxxing, spam floods) must be removed
entirely rather than merely hidden. It is a distinct, destructive capability layered on top
of hiding; separating it keeps the reversible everyday tool (hide) safe from accidental
permanent loss.

**Independent Test**: As an admin, delete a comment, confirm the confirmation step is
required, and verify that after deletion the comment no longer appears for any visitor or
admin and cannot be restored.

**Acceptance Scenarios**:

1. **Given** a comment, **When** an admin chooses to delete it, **Then** they are asked to
   confirm before the deletion is applied.
2. **Given** the delete confirmation, **When** the admin confirms, **Then** the comment is
   permanently removed and disappears from the comment list for everyone.
3. **Given** the delete confirmation, **When** the admin cancels, **Then** the comment is
   left unchanged.
4. **Given** a signed-in member (non-admin), **When** they view a trashpost, **Then** they
   see no delete control on any comment.
5. **Given** an admin deletes a comment, **When** the action completes, **Then** the
   comment list and comment count update without the admin losing their place on the page.

---

### Edge Cases

- **Empty / whitespace-only comment**: Rejected with validation; nothing is saved.
- **Over-length comment**: Rejected with validation before saving.
- **Markup / script in comment text**: Stored and displayed as literal text, never rendered
  as HTML or executed (XSS prevention).
- **Comment on a non-existent or unknown trashpost**: Attempting to comment on a trashpost
  that does not exist is refused with a not-found response; no comment is created.
- **Comment on a hidden / deleted trashpost**: Comments follow their trashpost — if a
  trashpost is not publicly visible (unactivated, hidden, or soft-deleted), its comment
  section is not reachable through public views, but the comments themselves are retained.
- **Trashpost permanently purged**: When a trashpost is permanently purged (hard-deleted),
  all of its comments are deleted with it (cascade); no orphaned comments remain.
- **Author account later removed**: A comment whose author account is later deleted still
  displays without breaking the list; the author is shown in a graceful fallback form rather
  than crashing the page. (See Assumptions.)
- **Concurrent moderation**: Two admins act on the same comment nearly simultaneously — the
  second action reflects the already-changed state without error.
- **Hide then delete**: A hidden comment can still be permanently deleted; deletion
  supersedes the hidden state.
- **Newly posted comment while others are loading**: A comment just added by the user
  appears at the top immediately, ahead of older comments, consistent with newest-first
  ordering.
- **Many comments**: A trashpost with a large number of comments loads its comments in
  newest-first batches rather than all at once, and the reader can request older comments.
  (See Assumptions.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a comment to be attached to a specific trashpost,
  identified by that trashpost's stable public code.
- **FR-002**: The system MUST display a trashpost's comments on that trashpost's page,
  ordered newest-first (most recently posted at the top).
- **FR-003**: Each displayed comment MUST show the author's name, the comment text, and the
  time it was posted.
- **FR-004**: The system MUST allow only users who are signed in **and** have a verified
  e-mail to create comments (the same gate as uploading, feature 008). Signed-out visitors
  and signed-in users with an unverified e-mail MUST be refused at the data layer, not merely
  hidden in the UI.
- **FR-005**: The comment-entry form MUST be shown only to signed-in users with a verified
  e-mail. Signed-out visitors MUST instead see a prompt to sign in; signed-in users with an
  unverified e-mail MUST instead see a prompt to verify their e-mail.
- **FR-006**: A newly created comment MUST be attributed to the account that created it and
  MUST appear at the top of that trashpost's comment list immediately after submission,
  without a full page reload and without losing the reader's place on the page.
- **FR-007**: The system MUST reject empty or whitespace-only comments with a clear
  validation message and MUST NOT persist them.
- **FR-008**: The system MUST enforce a maximum comment length of **1000 characters** and
  reject longer comments with a clear validation message before persisting.
- **FR-009**: Comment text MUST be treated as plain text: stored verbatim and displayed
  escaped for its output context so that any markup or script characters are shown
  literally and never rendered or executed.
- **FR-010**: The system MUST restrict comment moderation controls (hide, unhide, delete) to
  users ranked **admin or higher**; guests and members MUST NOT see or be able to invoke
  them.
- **FR-011**: An admin MUST be able to hide a visible comment. A hidden comment MUST be
  removed from what guests and members see, while remaining stored and still visible to
  admins, clearly marked as hidden using more than color alone.
- **FR-012**: An admin MUST be able to unhide a previously hidden comment, returning it to
  public visibility for all visitors. Hide/unhide MUST be reversible with no residual effect.
- **FR-013**: An admin MUST be able to permanently delete a comment. Permanent deletion MUST
  require an explicit confirmation step, and once confirmed the comment MUST be removed for
  everyone (including admins) and MUST NOT be recoverable through the application.
- **FR-014**: After any comment action (add, hide, unhide, delete), the acting user MUST
  remain in place on the trashpost page, and the comment list and comment count MUST reflect
  the new state.
- **FR-015**: The publicly shown comment count for a trashpost MUST count only comments
  visible to the public (excluding hidden and deleted comments).
- **FR-016**: When a trashpost has no publicly visible comments, its page MUST show an
  explicit "no comments yet" empty state.
- **FR-017**: Attempting to comment on a trashpost that does not exist (unknown public code)
  MUST be refused with a not-found response and MUST NOT create a comment.
- **FR-018**: The comment section (list, form, moderation controls, empty state) MUST be
  themed for light/dark per user preference, accessible (labeled form field and controls,
  appropriate roles/labels), and responsive across mobile, tablet, and desktop without
  horizontal overflow.
- **FR-019**: A trashpost's comments MUST load newest-first in batches: an initial batch of
  10, with an explicit "load more older comments" control that appends the next 10 older
  comments, rather than rendering all comments at once. The comment batch position is NOT
  reflected in the URL (comments are a sub-section of the trashpost page, which already has
  its own shareable URL).
- **FR-020**: When a trashpost is permanently purged (hard-deleted), all of its comments MUST
  be deleted with it, leaving no orphaned comments. Soft-deleting or hiding a trashpost MUST
  NOT delete its comments (they are retained but unreachable through public views).

### Key Entities *(include if feature involves data)*

- **Comment**: A piece of text a signed-in user attaches to one trashpost. Attributes:
  the trashpost it belongs to, the authoring account, the text body, the time it was
  created, and a hidden/visible moderation state. A comment is removed entirely on permanent
  deletion.
- **Trashpost**: The meme entry a comment belongs to, addressed by its stable public code.
  A trashpost has zero or more comments and a public comment count.
- **User / Account**: The author of a comment (must be signed in to create one) and the
  actor for moderation. Role determines moderation capability (admin or higher may hide,
  unhide, and delete comments).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in user can post a comment on a trashpost and see it appear at the
  top of the comment list within a couple of seconds, without a full page reload.
- **SC-002**: 100% of comment-creation attempts by signed-out visitors and by signed-in
  users with an unverified e-mail are refused and create no comment.
- **SC-003**: Comments are shown newest-first for 100% of trashposts that have comments.
- **SC-004**: 100% of comment moderation attempts (hide, unhide, delete) by guests and
  members are refused; admins and superusers succeed.
- **SC-005**: A hidden comment is invisible to 100% of guests and members while remaining
  visible (marked as hidden) to admins; the public comment count excludes it.
- **SC-006**: A permanently deleted comment is absent for 100% of viewers, including admins,
  after deletion, and cannot be recovered through the application.
- **SC-007**: Comment text containing markup or script characters is displayed literally in
  100% of cases and never executed.
- **SC-008**: The comment section presents without horizontal scrolling or clipped controls
  across mobile, tablet, and desktop widths, in both light and dark themes.

## Assumptions

- **Commenting requires a verified e-mail** (resolved in Clarifications): the gate is
  "signed in and e-mail verified", identical to the upload gate in feature 008. A signed-in
  but unverified account cannot comment and is prompted to verify.
- **Comments are displayed on the trashpost's own page** (the single-meme view), reusing the
  existing page, layout, theming, accessibility, and responsive behavior; no dedicated
  comments page and no separate admin comments console is introduced. Admins moderate
  comments inline on the trashpost page, consistent with the in-place post-page moderation
  established for trashposts.
- **Hide is reversible; delete is permanent.** "Hide" is a soft, admin-toggleable visibility
  flag (retain + conceal from the public); "delete" is a hard removal of the comment. This
  mirrors the trashpost moderation model but with only these two states for comments (no
  activation/pending workflow — a comment is publicly visible as soon as it is posted).
- **No self-service editing or deletion of one's own comment in this feature.** The only
  removal path is admin hide/delete, per the request. Users cannot edit or delete their own
  comments in v1.
- **Comments are flat (no threaded replies).** Nesting/reply-to is out of scope for v1.
- **Maximum comment length is 1000 characters** (resolved in Clarifications) and comments are
  **plain text** (no rich formatting, images, or embeds).
- **Comment loading** is newest-first in batches of 10 with an explicit "load more older
  comments" control (resolved in Clarifications), consistent with the site's
  incremental-loading convention; batch position is not reflected in the URL. Comments are a
  sub-section of the trashpost page, which already has its own shareable URL.
- **Comments follow their trashpost's lifecycle** (resolved in Clarifications): if a trashpost
  is not publicly visible (unactivated, hidden, or soft-deleted), its comment section is not
  reachable through public views, but the comments are retained. When a trashpost is
  permanently purged, its comments are cascade-deleted with it.
- **Author display and orphaned comments**: a comment shows its author's account name; if
  the author account is later removed, the comment is retained and its author is shown via a
  graceful fallback rather than breaking the list.
- **Comment creation is rate-limited per user** (Constitution Principle VI, abuse control):
  the create endpoint carries a per-user throttle, analogous to the upload throttle, so a
  single account cannot flood a post with comments; over-cap attempts are refused (HTTP 429)
  and create no comment. The cap is app configuration (env-tunable), **not** a new dependency.
- The feature reuses the existing authentication, role model (guest < member < admin <
  superuser), site layout, and moderation UI patterns; **no new third-party dependency** is
  assumed (Constitution Principle I).
