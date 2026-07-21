# Feature Specification: Admin User List

**Feature Branch**: `012-admin-user-list`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "lets create user list shown only for admins and above. show fields: name, email, role verified, created, disabled. add new column to table users: disabled_at timestamp, default null. add action to disable/enable an user to list. only lower level users can be edited"

## Clarifications

### Session 2026-07-20

- Q: Does disabling an account affect that user's memes (visibility or rating accrual)? → A: Access only — disabling revokes sign-in and live sessions; the account's memes stay live and keep accruing rating exactly as before. Content takedown remains the meme-moderation console's job.
- Q: How many accounts does the user list show per page? → A: 100 per page, matching the existing meme-moderation table.
- Q: Is there an audit trail for the disable/enable action? → A: Record who disabled the account — a nullable "disabled by" account reference stored alongside `disabled_at`, surfaced in the disabled column and cleared on enable. No separate full-history audit log.
- Q: Can an admin search or filter the user list to find a specific account? → A: No — newest-first paging only, matching the meme-moderation table. Search and filtering are out of scope for this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the account list (Priority: P1)

An admin (or higher-ranked user) opens a dedicated user-administration page and sees a
table of every registered account, newest first. Each row shows the account's name,
e-mail address, role, whether its e-mail is verified, when it was created, and whether it
is currently disabled. Pages are reached through dedicated page links and each page is a
real, bookmarkable, refresh-safe URL.

**Why this priority**: Visibility into the account base is the foundation of the feature —
without the list there is nothing to act on. It delivers standalone value (who signed up,
who never verified, who is disabled) before any action control exists.

**Independent Test**: Sign in as an admin, open the user list, and confirm every registered
account appears with all six columns populated, ordered newest-first, with working page
links reflected in the URL.

**Acceptance Scenarios**:

1. **Given** an admin is signed in and accounts exist, **When** they open the user list,
   **Then** they see a table of accounts ordered newest-first with columns name, e-mail,
   role, verified, created, and disabled, plus an action control per row.
2. **Given** more accounts exist than fit on one page, **When** the admin uses the page
   links, **Then** the URL reflects the selected page and the table shows that page's
   accounts.
3. **Given** the admin is on a specific page, **When** they refresh or share the URL,
   **Then** the same page of results is restored.
4. **Given** an account whose e-mail has never been verified, **When** its row renders,
   **Then** the verified column indicates "not verified" by means other than color alone.
5. **Given** an account that is currently disabled, **When** its row renders, **Then** the
   disabled column indicates the disabled state and shows when it was disabled and by whom.

---

### User Story 2 - Restrict the list to admins and above (Priority: P1)

Only users ranked admin or higher may reach the user list or the data behind it. Guests and
ordinary members are refused and never see account data or user-administration controls.

**Why this priority**: The page exposes personal data (e-mail addresses, verification state)
and account-affecting actions; unauthorized access is both a security and a privacy failure.
The gate must exist before the list is exposed to any real traffic.

**Independent Test**: Attempt to reach the user list and its underlying data as a guest, as
a member, as an admin, and as a superuser; confirm only admin and superuser succeed.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they request the user list or its data,
   **Then** access is refused.
2. **Given** a signed-in member, **When** they request the user list or its data,
   **Then** access is refused.
3. **Given** a signed-in admin or superuser, **When** they request the user list,
   **Then** they are allowed in and the table loads.
4. **Given** the site navigation, **When** it renders for a guest or member, **Then** no
   user-list link is shown; **When** it renders for an admin or superuser, **Then** the
   user-list link is shown.

---

### User Story 3 - Disable and re-enable an account (Priority: P1)

From a row, an admin can disable an account — revoking its ability to sign in and use the
site — or re-enable a previously disabled account. The row reflects the new state and the
admin keeps their place in the table.

**Why this priority**: Cutting off an abusive or compromised account is the reason the list
exists; the ability to reverse it prevents a mistaken action from being permanent.

**Independent Test**: As an admin, disable a member account and confirm that account can no
longer sign in and its row shows as disabled; then enable it and confirm sign-in works again
and the row shows as active.

**Acceptance Scenarios**:

1. **Given** an active account ranked below the acting admin, **When** the admin uses its
   Disable action, **Then** the account becomes disabled, the moment of disabling is
   recorded, and the row shows it as disabled.
2. **Given** a disabled account ranked below the acting admin, **When** the admin uses its
   Enable action, **Then** the account returns to the active state and the row shows it as
   active.
3. **Given** a disabled account, **When** that account's owner attempts to sign in,
   **Then** sign-in is refused with a message telling them the account is disabled.
4. **Given** a disabled account with a live signed-in session, **When** that session makes
   its next request, **Then** the session no longer grants access.
5. **Given** any row, **When** it renders, **Then** it offers exactly the control that
   applies to its state (Disable when active, Enable when disabled).
6. **Given** the admin disables or enables an account on page N, **When** the action
   completes, **Then** they remain on page N and only that row's state changes.

---

### User Story 4 - Protect peers and higher ranks from edits (Priority: P1)

An admin may only act on accounts ranked strictly below their own role. Accounts at the
same rank or higher — including the admin's own account — are shown in the list but cannot
be disabled or enabled by that admin.

**Why this priority**: Without this rule any admin could disable every other admin, the
superuser, or themselves, locking the site's own operators out. It is a privilege-escalation
guard and must ship together with the action itself.

**Independent Test**: As an admin, confirm the action control is unavailable on rows for
other admins, superusers, and the admin's own account, and that a direct attempt to disable
such an account is refused; as a superuser, confirm admins and members can be acted on but
other superusers cannot.

**Acceptance Scenarios**:

1. **Given** an admin viewing another admin's row, **When** the row renders, **Then** no
   enable/disable control is offered and the reason is conveyed to the admin.
2. **Given** an admin viewing a superuser's row, **When** the row renders, **Then** no
   enable/disable control is offered.
3. **Given** an admin viewing their own row, **When** the row renders, **Then** no
   enable/disable control is offered.
4. **Given** an admin, **When** a disable or enable is submitted for an account at or above
   their own rank by any means, **Then** the request is refused and the target account is
   unchanged.
5. **Given** a superuser, **When** they act on an admin or member account, **Then** the
   action succeeds; **When** they act on another superuser, **Then** it is refused.

---

### Edge Cases

- **Empty list**: No accounts other than the viewer exist — the page shows an explicit
  "no entries" state rather than a blank table.
- **Out-of-range page**: A page number beyond the last page shows an empty/last-page state
  rather than an error.
- **Self-lockout**: The acting admin's own row can never be disabled, on any page.
- **Last superuser**: The final remaining superuser account cannot be disabled, because no
  one outranks it — the rule in US4 already produces this outcome.
- **Concurrent action**: Two admins act on the same account nearly simultaneously — the
  second action reflects the already-changed state without error.
- **Role change mid-view**: A target's role is raised above the viewer's while the page is
  open — a subsequently submitted action for that account is refused on current data, not
  on the stale rendering.
- **Repeated toggles**: Disabling then enabling the same account returns it cleanly to the
  active state with no residual effect — including no leftover "disabled by" reference.
- **Unresolvable actor**: The account recorded as having disabled someone can no longer be
  resolved — the disabled column degrades to showing the timestamp alone rather than breaking
  the row.
- **Disabled user's active session**: Access ends on the next request; the user is not left
  in a half-signed-in state.
- **Disabled account attempts recovery flows**: Registration or verification-resend attempts
  for a disabled account do not silently re-activate it.
- **Never-verified and disabled at once**: Both states are shown independently; neither
  column overrides the other.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a dedicated user-administration page, reachable at its
  own shareable URL, that lists registered accounts in a table.
- **FR-002**: Access to the user list and the data behind it MUST be restricted to users
  ranked **admin or higher**; guests and members MUST be refused.
- **FR-003**: The system MUST expose a link to the user list within the existing site
  navigation, visible only to users ranked admin or higher. The URL itself remains directly
  reachable and role-gated per FR-002.
- **FR-004**: Each row MUST display these columns: (1) name, (2) e-mail address, (3) role,
  (4) e-mail verified, (5) created datetime, (6) disabled state, (7) action control.
- **FR-005**: The verified and disabled columns MUST convey their state by more than color
  alone; the disabled column MUST also show when the account was disabled and which account
  disabled it.
- **FR-006**: The list MUST order accounts newest-first by creation time and MUST include
  accounts of every state (verified or not, disabled or not, any role).
- **FR-006a**: The list MUST show at most 100 accounts per page.
- **FR-007**: The list MUST be paginated with dedicated page links, and the selected page
  MUST be reflected in the URL so it is bookmarkable and refresh-safe (Back/Forward/Refresh
  restore the same page).
- **FR-008**: The system MUST record, per account, whether and when it was disabled, using a
  nullable point-in-time value that is empty for active accounts (`users.disabled_at`).
- **FR-008a**: The system MUST record which account performed the disable, as a nullable
  reference stored alongside the disabled moment. Both values MUST be set together on disable
  and cleared together on enable, so an active account never carries a stale actor reference.
- **FR-008b**: The acting account's identity MUST be taken from the authenticated session,
  never from client-supplied input.
- **FR-009**: Each row MUST offer a single reversible control that reflects the row's current
  state: **Disable** for an active account, **Enable** for a disabled account. Both apply on
  a single click without a confirmation step.
- **FR-010**: A disable MUST set the account's disabled moment to the current time; an enable
  MUST clear it, along with the "disabled by" reference (FR-008a). Neither action MUST alter the account's role, e-mail, verification state, or
  uploaded content, and MUST NOT change that account's accumulated rating.
- **FR-010a**: Disabling an account MUST NOT change the visibility or activation state of any
  meme it owns, and MUST NOT suspend or alter its rating accrual. Content takedown remains the
  responsibility of the existing meme-moderation console.
- **FR-011**: An actor MUST only be able to disable or enable accounts ranked **strictly
  below** their own role. Attempts against equal-or-higher-ranked accounts — including the
  actor's own account — MUST be refused, both in the interface (no control offered) and on
  the server (request rejected), and MUST leave the target unchanged.
- **FR-012**: The rank comparison for FR-011 MUST be evaluated server-side against the
  current stored roles at the moment the action is applied, never against values supplied by
  the client.
- **FR-013**: A disabled account MUST NOT be able to authenticate. Sign-in attempts MUST be
  refused with a message stating the account is disabled, distinct from a wrong-credentials
  message.
- **FR-014**: An existing signed-in session belonging to an account that becomes disabled
  MUST stop granting access from its next request onward.
- **FR-015**: Re-enabling an account MUST restore its ability to sign in with its existing
  credentials, with no re-registration or re-verification required.
- **FR-016**: After any disable or enable, the admin MUST remain on the same page of the
  table and the affected row MUST reflect the new state.
- **FR-017**: The page MUST render an explicit empty state when there are no accounts to show.
- **FR-018**: Account e-mail addresses and roles MUST be exposed only to admins and above,
  and MUST NOT be added to any public or member-facing response as a side effect of this
  feature.
- **FR-019**: The page MUST be themed (light/dark per user preference), accessible (labeled
  controls, appropriate roles/labels on the table and its actions), and responsive across
  mobile, tablet, and desktop without horizontal overflow.
- **FR-020**: Rows MUST be identified in URLs and requests by a non-enumerable public handle
  rather than a database auto-increment id.

### Key Entities *(include if feature involves data)*

- **User / Account**: A registered account. Attributes relevant here: display name, e-mail
  address, role (guest < member < admin < superuser; guest is never stored), e-mail
  verification moment, creation time, and (new) the moment it was disabled plus a reference to
  the account that disabled it — both empty while active.
- **User list view**: A paginated, newest-first projection of accounts with a per-row
  enable/disable control, available only to admins and above. Which rows offer that control
  depends on the viewer's own rank relative to each row's account.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can locate the user list and see the first page of accounts,
  newest-first, within a few seconds of opening it.
- **SC-002**: 100% of user-list access attempts by guests and members are refused; 100% of
  attempts by admins and superusers succeed.
- **SC-003**: 100% of disable/enable attempts against an account at or above the actor's own
  rank are refused, and the target account is left unchanged in every such case.
- **SC-004**: A disabled account cannot sign in on any attempt, and an already-signed-in
  session for that account stops working on its next request.
- **SC-005**: An admin can disable or enable a lower-ranked account and see the row's state
  update without losing their current page, in a single action per row.
- **SC-006**: Re-enabling an account restores sign-in with the original credentials on the
  first attempt, with no other account data changed.
- **SC-007**: Page navigation is fully bookmarkable and refresh-safe: reloading or sharing a
  page URL restores exactly that page of results.
- **SC-008**: The page presents without horizontal scrolling or clipped controls across
  mobile, tablet, and desktop widths, in both light and dark themes.

## Assumptions

- **"Admins and above"** maps to the existing role order (guest < member < admin <
  superuser); admin and superuser are allowed, guest and member are refused — the same gate
  the meme-moderation console already uses.
- The requested field "role verified" is read as **two separate columns**, role and
  e-mail-verified, matching the account data the site already stores. If a single combined
  column was intended, this assumption must be revised.
- **"Name"** is the account's existing display name/username; no new naming concept is
  introduced.
- **"Only lower level users can be edited"** is read as *strictly* lower rank: an admin
  cannot act on another admin, a superuser, or themselves. Equal rank is not "lower".
- **Disabling** is an access revocation only: the account is blocked from signing in and its
  live sessions stop working. It does **not** delete the account, change its role, or hide
  its previously uploaded memes; content moderation stays with the existing meme-moderation
  console, and their rating keeps accruing untouched (clarified 2026-07-20).
- The only action in this list is **enable/disable**. Editing names, e-mails, roles, or
  passwords from this page is out of scope for this feature.
- **Search, filtering, and column sorting are out of scope** (clarified 2026-07-20): accounts
  are found by paging the newest-first list. If the account base grows large enough that
  locating a specific user becomes painful, search is a follow-up feature.
- **Pagination** is page-based with dedicated links at 100 rows per page, consistent with
  the existing back-office moderation table rather than the public feed.
- Disabled state is stored as a nullable point-in-time value on the account record
  (`users.disabled_at`, default empty) together with a nullable reference to the acting
  account (clarified 2026-07-20); adding both is one schema change through the normal
  migration path. No separate audit-log table is introduced — the record reflects only the
  most recent disable, not a full history.
- The page reuses the existing site layout, theming, accessibility, responsive behavior, and
  role gate established by prior features; no new third-party dependency is assumed.
- Actions are performed by an authenticated admin session; the same admin-or-higher gate
  applies to the actions as to viewing the list.
