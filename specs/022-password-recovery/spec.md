# Feature Specification: Password Recovery and Change

**Feature Branch**: `022-password-recovery`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "add pwd recovery logic. check prototype to how to implement it" —
followed by "also add pwd change form to account page"

## Overview

Today an account holder who forgets their password has no way back in. The sign-in form is the
only door, and it offers nothing but "Email or password is incorrect." Support has no lever
either — there is no self-service recovery and no operator-driven one.

This feature adds the standard self-service recovery journey: from the sign-in form, a person
asks for a recovery link, receives it at the address on the account, opens it, chooses a new
password, and signs in again. Control of the inbox is the only proof of ownership accepted.

The earlier prototype (`C:\projects\trash`) sketched exactly this journey — a "Forgot password?"
link on its sign-in form pointing at a reset view, a request-a-link step, and a stored,
time-limited, single-address token — but the work was never finished (its reset view still calls
the registration action and never submits an address). This specification completes the journey
the prototype started, on Ladybug's own terms: the site's existing email delivery, its generic
non-enumerating sign-in behaviour, and the account states that Ladybug has since grown
(unverified addresses, disabled accounts, Google-linked accounts).

It also covers the deliberate half of the same problem: an account holder who still knows their
password and simply wants to change it gets a password section on their account page, next to
the display-name section already there. That path needs no inbox at all — the live session plus
the current password is the proof — and it is what someone reaches for after sharing a password
or reusing one they now regret.

Nothing about registration, sign-in, verification, roles, or account administration changes.

## Clarifications

### Session 2026-08-07

- Q: Should a password change from the account page invalidate an already-emailed recovery link that is still within its window? → A: Yes — a successful password change by either route voids every outstanding link for that account
- Q: What should the requester see when the recovery email genuinely fails to send (mail service down or rejecting)? → A: The same generic confirmation, with the delivery failure raised server-side so it reaches ordinary error reporting
- Q: Should the page reached by a valid recovery link display the account's email address? → A: No — no page in the journey prints an account detail, valid link or refusal alike
- Q: Should the reset-form submission be rate-limited against bulk token guessing? → A: Yes — capped per requester on the same footing as the sign-in limit, with token entropy still the primary defence
- Q: Should password changes be recorded anywhere for later operator review? → A: No — no audit record and no timestamp, matching feature 013's deliberate no-audit-trail choice

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask for a recovery link (Priority: P1)

Someone who cannot remember their password opens the sign-in form, follows a clearly visible
"Forgot password?" control, types the address they registered with, and submits. The site
confirms that if an account exists for that address a recovery link is on its way, and the
message it shows is the same whether or not an account actually exists. A person with an
account receives an email containing a single link back to the site.

**Why this priority**: Without the request step there is no recovery at all. It is the entry
point every other part of the journey depends on, and on its own it already tells a stuck user
that recovery exists and what to check.

**Independent Test**: Request a link for a registered address and confirm an email carrying a
link is produced; request one for an address with no account and confirm the on-screen outcome
is identical and no email is produced. Fully testable without the link ever being opened.

**Acceptance Scenarios**:

1. **Given** a visitor on the sign-in form, **When** they look at the form, **Then** a
   "Forgot password?" control is visible and leads to the recovery request view.
2. **Given** the recovery request view, **When** a visitor submits the address of an existing
   account, **Then** they see a confirmation telling them to check that inbox, and an email
   containing a recovery link is sent to that address.
3. **Given** the recovery request view, **When** a visitor submits an address no account uses,
   **Then** they see the identical confirmation and no email is sent to anyone.
4. **Given** the recovery request view, **When** a visitor submits a malformed address or an
   empty field, **Then** the field is flagged inline, nothing is sent, and the entered value is
   preserved.
5. **Given** a visitor who has just requested a link, **When** they immediately request another
   for the same address, **Then** the site responds without error and does not flood the inbox
   (see FR-009).

---

### User Story 2 - Choose a new password from the link (Priority: P1)

The account holder opens the link from their inbox and lands on a page that asks for a new
password twice. The page never asks for the old password. On success the site confirms the
change and puts them on the sign-in path with their new password working immediately.

**Why this priority**: This is the step that actually restores access. Together with US1 it is
the minimum viable feature; either one alone leaves the user stranded.

**Independent Test**: Starting from a valid, unused link, set a new password and confirm the
old password no longer signs in while the new one does.

**Acceptance Scenarios**:

1. **Given** a valid, unexpired, unused recovery link, **When** the account holder opens it,
   **Then** they see a form asking for a new password and a confirmation of it, with no email
   address, display name, or other account detail printed anywhere on the page, and no account
   field editable.
2. **Given** that form, **When** they submit a new password meeting the site's password policy
   twice identically, **Then** the password is changed, they see a success confirmation, and
   they can sign in with the new password.
3. **Given** that form, **When** the two password fields do not match, **Then** the mismatch is
   reported inline, nothing changes, and the link remains usable.
4. **Given** that form, **When** the new password fails the site's password policy, **Then** the
   specific rule that failed is reported inline, nothing changes, and the link remains usable.
5. **Given** a completed reset, **When** the person attempts to sign in with the old password,
   **Then** it is refused exactly as any wrong password is.
6. **Given** a completed reset, **When** the same link is opened again, **Then** it is refused as
   no longer valid (US4).

---

### User Story 3 - Change the password while signed in (Priority: P2)

Someone who still knows their password — and is signed in — wants to change it without going
anywhere near their inbox. On their account page they find a password section, prove themselves
by typing the password they have now, choose a new one twice, and it takes effect immediately.

**Why this priority**: It is the routine, deliberate half of password management: rotating a
password you suspect was shared, or replacing one you never liked. It needs no email at all, so
it is independent of the recovery journey in both directions — it works if recovery is not
built, and recovery works if it is not. It sits below the P1 recovery pair only because someone
who *can* still sign in is not locked out.

**Independent Test**: Sign in, change the password from the account page, then confirm the new
password signs in and the old one does not — without any email being sent or any link involved.

**Acceptance Scenarios**:

1. **Given** a signed-in account holder on their account page, **When** the page renders,
   **Then** a clearly labelled password section is present alongside the existing display-name
   section.
2. **Given** that section, **When** they submit their current password plus a new password and
   its confirmation, **Then** the password changes, they see a success confirmation, and they
   remain signed in on that client.
3. **Given** that section, **When** the current password they type is wrong, **Then** that field
   is flagged inline, nothing changes, and neither the new password nor the confirmation is
   repopulated.
4. **Given** that section, **When** the new password fails the site's password policy or does
   not match its confirmation, **Then** the specific failure is reported inline and nothing
   changes.
5. **Given** a completed change, **When** the person signs in elsewhere with the old password,
   **Then** it is refused, and every other session and remembered credential for the account has
   already stopped working (US5).
6. **Given** an account that signs in with Google only and has no password yet, **When** they
   open the section, **Then** it asks only for a new password and its confirmation — there is no
   current password to prove — and submitting it gives the account a password without disturbing
   its Google sign-in.
7. **Given** a signed-out visitor, **When** they open the account address, **Then** they are sent
   to sign in exactly as they are today; the password section is never reachable without a
   session.

---

### User Story 4 - Dead, spent, and tampered links (Priority: P2)

A link that is too old, already used, altered in transit, or pointing at an account that no
longer exists must fail clearly and safely. The person is told the link is no longer usable and
is offered a one-click way to request a fresh one, rather than being dropped on a blank page or
a raw error.

**Why this priority**: Recovery links reach real inboxes and get opened late, twice, from
previews, and after forwarding. Without this the most common non-happy path is a dead end, but
the feature still delivers value without it, so it ranks below the two P1 stories.

**Independent Test**: Open an expired link, a link already used once, and a link whose token has
been altered by one character; confirm each shows the same clear "no longer valid" outcome with
a path to request a new one, and that no password changes.

**Acceptance Scenarios**:

1. **Given** a link older than the validity window, **When** it is opened, **Then** the site
   states it is no longer valid and offers a control to request a new one.
2. **Given** a link that has already completed a reset, **When** it is opened again, **Then** it
   is refused the same way, and the password set by the first use is untouched.
3. **Given** a link whose token or address has been altered, **When** it is opened or submitted,
   **Then** it is refused the same way, with no hint as to which part was wrong and no
   indication of whether the address belongs to an account.
4. **Given** a link for an account that has since been deleted, **When** it is opened, **Then**
   it is refused the same way.
5. **Given** a refusal, **When** the person requests a fresh link from that page, **Then** they
   re-enter the US1 journey.

---

### User Story 5 - A password change ends every other session (Priority: P3)

Someone who suspects their password leaked changes it — by recovery link or from their account
page — and expects that to actually lock the intruder out: every signed-in session on every
other device, and any "remember me" that would silently sign someone back in, stops working.

**Why this priority**: It is what makes a password change a security control rather than a
convenience. It is separable from the ability to change the password at all, so it ships after
the P1/P2 stories.

**Independent Test**: Sign in on two independent clients, change the password from a third
(once via recovery link, once from the account page), then confirm the two existing sessions are
refused on their next request and that a "remember me" from before it no longer restores a
session.

**Acceptance Scenarios**:

1. **Given** an account signed in on another client, **When** its password is reset via a
   recovery link, **Then** that other session no longer grants access on its next request and
   the client is returned to signed-out state.
2. **Given** an account with an active "remember me" from before the change, **When** the
   password is reset, **Then** that remembered credential no longer signs the person in.
3. **Given** a completed reset, **When** the person signs in with the new password, **Then** a
   normal session is established with the account's existing role and verification state
   unchanged.

---

### Edge Cases

#### Recovery by link

- **Address with no account**: Same on-screen outcome as a real one, no email, no timing or
  wording that distinguishes the two (FR-004).
- **Disabled account** (feature 012): the request is accepted with the same generic
  confirmation, but no recovery email is sent and no password can be set — recovery must not be
  a way around an administrator's revocation.
- **Unverified address** (feature 008): recovery works. Opening the link proves control of the
  inbox in exactly the way verification does, so refusing here would strand people whose
  verification mail was lost. Whether it also marks the address verified is FR-020.
- **Account that signs in only with Google** (feature 017) and therefore has no password at all:
  recovery is allowed and *adds* a password to the account, leaving the Google link working
  (FR-019). The wording of the recovery email does not have to differ from any other.
- **Person is already signed in** when they open a recovery link: the link is honoured for the
  account it names, not for the signed-in one; if the two differ, the link's own account is the
  one reset and the signed-in session is subject to FR-016 only when it belongs to that account.
- **Address changes between request and use**: the outstanding link stops working, because it
  names the address it was issued for. **Unreachable today** — the site offers no way to change an
  account's address, and this feature does not add one (Out of Scope). Recorded because the link's
  shape makes the outcome automatic rather than because a code path needs building or testing: if
  an address-change feature ever lands, this behaviour comes with it for free.
- **Two links requested in a row**: only the newest is usable; the older is refused like any
  spent link.
- **New password identical to the current one**: accepted (the site cannot tell a deliberate
  re-set from a mistake, and refusing would confirm the old password to whoever holds the link).
- **Repeated requests for the same address**: rate-limited so an inbox cannot be used as a
  harassment channel (FR-009).
- **Bulk requests from one source**: rate-limited per requester like the existing sign-in and
  registration forms (FR-010).
- **Mail delivery fails** (service down or rejecting): the requester sees the same confirmation
  as always, and the failure is raised server-side rather than swallowed (FR-032). A mail outage
  is therefore visible to the operator and invisible to anyone probing the form.
- **Link opened by an inbox scanner or email preview** before the person clicks it: opening the
  link alone must not consume it — only submitting a new password does.
- **Guessed tokens fired at the reset form in bulk**: capped per requester like sign-in
  (FR-033), and the refusal at the cap says nothing about any account or token.
- **Browser Back/Forward/Refresh** on every view in the journey restores the correct state, and
  a submitted password is never repopulated into the form.

#### Changing the password from the account page

- **Wrong current password**: refused inline on that field with no session change and no lockout
  of the person's own session; repeated wrong attempts are rate-limited (FR-030) so a borrowed
  session cannot be used to brute-force the existing password.
- **Account with no password yet** (Google-only, feature 017): the current-password field is
  absent rather than present-and-optional, so there is nothing to leave blank or guess at; the
  live session is the proof of identity.
- **New password identical to the current one**: accepted here too, for consistency with the
  recovery path.
- **An outstanding recovery link exists** when the password is changed here: the link is voided
  by the change (FR-008) and is afterwards refused like any spent one, so a compromised inbox
  cannot undo the change.
- **Session ends mid-form** (signed out elsewhere, or the account is disabled by an
  administrator between page load and submit): the submission is refused as unauthenticated and
  the person is sent to sign in; no password changes.
- **Disabled account**: cannot reach the account page at all — its next request is already
  refused (feature 012) — so no separate rule is needed.
- **Both password fields** must be submitted together; a partially filled section reports the
  missing field inline and changes nothing.

## Requirements *(mandatory)*

### Functional Requirements

> **On the numbering**: FR-032, FR-033 and FR-034 were added by the 2026-08-07 clarification
> session and are filed under the heading they belong to rather than appended at the end, so the
> identifiers run out of sequence within a section. The identifiers are stable and referenced
> across `plan.md`, `research.md`, `data-model.md`, `contracts/` and `tasks.md`; they are
> deliberately **not** renumbered, because a renumber would touch every one of those references to
> buy nothing but tidier reading order.

#### Requesting a link

- **FR-001**: The sign-in view MUST offer a visible, labelled control that leads to the password
  recovery request view.
- **FR-002**: The recovery request view MUST have its own shareable address, reachable directly,
  and MUST be usable by signed-out visitors.
- **FR-003**: The system MUST accept an email address on that view, validate its shape before
  submission and again on the server, and reject an empty or malformed address inline without
  sending anything.
- **FR-004**: The response to a well-formed request MUST be identical — same status, same body,
  same wording, same headers — whether or not an account exists for that address, whether or not
  it is verified, and whether or not it is disabled. Recovery MUST NOT become an
  account-existence oracle. Response **timing is explicitly outside this requirement**: the
  eligible path mints and bcrypt-hashes a token and sends a message synchronously, work the
  ineligible paths do not do, and no artificial delay or dummy hashing is added to mask the
  difference (research D12). What is promised is that nothing the site *says* varies with account
  state; a wall-clock measurement is not a promise this feature makes.
- **FR-005**: When an account exists for the address, is not disabled, and is eligible under
  FR-019, the system MUST send exactly one recovery email to that address, containing a single
  link back to the site and no password.
- **FR-006**: The system MUST NOT send a recovery email to any address with no account, or to a
  disabled account.
- **FR-007**: A recovery link MUST be valid for a bounded time window (default: 60 minutes) after
  which it is refused.
- **FR-008**: Issuing a new link for an address MUST invalidate any link previously issued for
  that address. A successful password change by EITHER route — a link used, or the account page
  (FR-028) — MUST likewise void every outstanding link for that account. A password change is
  what ends a link's life, whichever way the change was made: an account holder who suspects
  their inbox is compromised can therefore shut an attacker's outstanding link by changing their
  password from the account page.
- **FR-009**: The system MUST limit how often a recovery email can be sent to the same address
  (default: at most one per 60 seconds), and a request suppressed by that limit MUST still
  produce the FR-004 response.
- **FR-010**: The system MUST limit how many recovery requests one requester can make per
  minute, consistent with the existing sign-in and registration limits, and MUST refuse beyond
  that limit without revealing anything about any account.
- **FR-032**: When the recovery email cannot be delivered — the mail service is unreachable or
  rejects the message — the requester MUST still receive the FR-004 generic confirmation, so a
  delivery failure never becomes a signal about the account. The failure MUST NOT be swallowed:
  it MUST be raised as an error on the server so it reaches the operator through ordinary error
  reporting.

#### Using a link

- **FR-011**: Opening a valid recovery link MUST present a form for a new password and its
  confirmation, at its own shareable address, without requiring a session and without asking for
  the current password. The page MUST NOT print the account's email address, display name, or
  any other account detail — no page in this journey does, valid link and refusal (FR-015)
  alike, so a forwarded or leaked link discloses nothing beyond what its holder already has.
- **FR-012**: Merely opening a link MUST NOT consume, expire, or otherwise alter it; only a
  successful password change consumes it.
- **FR-013**: The new password MUST be validated against the same policy registration enforces
  (minimum 8 characters, mixed case, at least one number) and MUST match its confirmation, both
  client-side for feedback and server-side as the authority.
- **FR-014**: On success the system MUST replace the account's password, invalidate the link,
  confirm the change on screen, and direct the person to sign in with the new password.
- **FR-015**: A link that is expired, already consumed, altered, or names an account that no
  longer exists MUST be refused with one indistinguishable message that names no account
  detail, and that offers a path back to the request view. No password may change.
- **FR-016**: A successful password change by EITHER route — recovery link or the account page —
  MUST end every other active session for that account and invalidate any "remember me"
  credential issued before it (feature 018), so the next request from those clients is treated
  as signed out. The client that performed the change keeps its own session where it had one
  (the account page, FR-028); the recovery route has none to keep (FR-021).
- **FR-017**: A successful password change by either route MUST NOT change the account's role,
  rating, display name, disabled state, uploaded memes, comments, or linked sign-in providers.
- **FR-018**: The recovery token MUST be unguessable, stored so that a database read alone does
  not yield a usable link, and MUST never appear in the site's own logs or in any page that
  search engines may index. The recovery views MUST be excluded from indexing like the other
  account views.
- **FR-019**: An account that has no password because it signs in with Google only (feature 017)
  MUST be eligible for recovery on the same terms as any other account: it receives the link,
  and completing the journey gives it a password credential *in addition to* its Google sign-in.
  Neither credential displaces the other — the account can afterwards sign in either way, and
  its Google link is untouched (FR-017). This is what lets someone who loses access to their
  Google account keep their Ladybug account.
- **FR-020**: A successful reset MUST NOT change the account's email verification state; an
  unverified account stays unverified and still sees the verification prompts it saw before.
- **FR-021**: A successful reset MUST NOT itself establish a session. The person MUST be
  returned to the sign-in form and MUST sign in with the password they just set. Holding the
  emailed link therefore grants the ability to set a password, never a signed-in session
  directly.
- **FR-033**: Submissions of the reset form MUST be rate-limited per requester, on the same
  footing as the existing sign-in limit, so guessed tokens cannot be tested in bulk. The token's
  unguessability (FR-018) remains the primary defence; the limit bounds how fast any guess can
  be attempted. Refusal at the limit MUST reveal nothing about any account or token.
- **FR-034**: A password change MUST NOT be recorded for later review: no audit entry, no
  security-event record, and no "password last changed" timestamp on the account. Beyond
  ordinary request logs — which never carry the token (FR-018) — a change leaves no trace. This
  follows feature 013's deliberate choice to keep no audit trail; an operator-facing history is
  a separate feature if one is ever wanted.

#### Presentation

- **FR-022**: Every view in this journey MUST match the existing sign-in and registration forms
  in structure, labelling, and error presentation, MUST follow the site's light/dark preference,
  and MUST be operable at mobile, tablet, and desktop widths. The account page's password
  section MUST match its neighbouring display-name section the same way.
- **FR-023**: Every input MUST have an associated label; every error MUST be conveyed in text
  and announced to assistive technology, never by colour alone.
- **FR-024**: Back, Forward, and Refresh MUST restore the correct view at every step, and a
  submitted password MUST never be repopulated into a form.
- **FR-025**: Both recovery addresses MUST answer as real pages when opened directly or shared,
  not as "not found". The password section adds no new address — it lives on the existing
  account page.

#### Changing the password while signed in

- **FR-026**: The account page MUST present a labelled password section alongside its existing
  display-name section, reachable only with a session (the page's existing sign-in requirement
  is unchanged) and needing no email and no link.
- **FR-027**: For an account that has a password, the section MUST require the current password
  in addition to the new password and its confirmation, and MUST refuse the change when the
  current password is wrong. A live session alone is not sufficient proof to replace a
  credential the person may not know.
- **FR-028**: On success the system MUST replace the password, confirm the change on screen,
  and leave the acting client signed in — it MUST NOT sign the person out of the client they
  just used.
- **FR-029**: The new password MUST be held to the same policy and confirmation rule as FR-013,
  validated server-side as the authority; a rejected submission MUST change nothing and MUST NOT
  repopulate any password field.
- **FR-030**: Attempts against the current-password field MUST be rate-limited per account,
  consistent with the existing sign-in limit, so a borrowed or stolen session cannot be used to
  brute-force the password it did not come with.
- **FR-031**: For an account with no password (Google-only, feature 017), the section MUST omit
  the current-password field entirely and MUST set a password on submission, leaving the Google
  sign-in working exactly as FR-019 does for the recovery route. The section MUST state which
  case it is in, in text.

### Key Entities

- **Recovery request**: An outstanding permission to set a new password for one email address.
  Holds the address it was issued for, an unguessable secret whose usable form exists only in
  the emailed link, and the moment it was issued (from which expiry and the resend interval are
  derived). At most one is outstanding per address; it disappears when used or superseded.
- **Account**: The existing user record. Both routes read its address and existence, and write
  only its password credential and the session/remember state that depends on it. Whether it
  currently *has* a password is itself a readable fact, because it decides whether the account
  page asks for a current one (FR-031).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who knows their registered address can regain access — from the sign-in
  form to a working new password — in under 3 minutes and without contacting anyone.
- **SC-002**: The recovery journey takes no more than 4 steps: open the request view, submit the
  address, open the emailed link, submit the new password.
- **SC-003**: 100% of requests for addresses with no account produce a response — status, body and
  headers alike — indistinguishable from one for a real account, verified across the five account
  states (real and enabled, unknown, disabled, inside the resend interval, mail transport failing)
  with four paired attempts each: 20 paired attempts in all. Per-requester rate-limit headers are
  excluded from the comparison, because they count the caller's own traffic and never the
  submitted address; timing is excluded per FR-004.
- **SC-004**: 100% of expired, reused, altered, and superseded links are refused — including
  every link left outstanding when the password was changed by the other route — and in no case
  does a password change.
- **SC-005**: After a password change by either route, 100% of other sessions and remembered
  credentials for that account stop granting access on their next use, while the account page's
  own client stays signed in in 100% of trials.
- **SC-006**: An account holder who completes recovery can sign in with the new password on the
  first attempt in 100% of trials, and the old password never works. (The behaviour is
  deterministic; a percentage below 100 would describe a bug, not a tolerance.)
- **SC-007**: No account state other than the password and its dependent sessions differs before
  and after a change by either route, verified field by field.
- **SC-008**: Every view in the journey, and the account page's password section, passes the
  site's existing checks: light and dark appearance, 320px through wide desktop without
  horizontal scrolling, labelled inputs, and correct Back/Forward/Refresh behaviour.
- **SC-009**: A signed-in account holder can change their password from the account page in
  under 60 seconds without leaving the site or opening an inbox.
- **SC-010**: 100% of account-page attempts carrying a wrong current password are refused with
  no password change, and repeated wrong attempts are cut off by the rate limit.

## Assumptions

- The site already sends email (the verification messages of feature 008) and recovery reuses
  that same delivery path and sender identity; no new delivery mechanism is introduced.
- The password policy is the one registration already enforces — minimum 8 characters, mixed
  case, at least one number. Recovery does not introduce a stricter or looser rule, and the
  deferred compromised-password check stays deferred.
- The 60-minute validity window and the 60-second resend interval are the defaults carried over
  from the prototype's configuration; both are configuration, not hard-coded behaviour.
- Recovery is keyed on the email address the account holder registered with. Someone who has
  lost access to that inbox cannot self-recover; operator-assisted recovery is out of scope.
- Non-enumeration on this journey follows the existing sign-in behaviour rather than
  registration's, which deliberately reveals a taken address. Registration's behaviour is not
  changed by this feature.
- Disabled accounts (feature 012) are excluded from recovery because disabling is access
  revocation; the exclusion is invisible to the requester per FR-004.
- One recovery request may be outstanding per address at a time; a newer request replaces an
  older one rather than both remaining usable, and any password change clears it (FR-008).
- The site has ordinary server-side error reporting that an operator sees, which is what FR-032
  raises a mail-delivery failure into. No new alerting or monitoring surface is introduced.
- Recovery is treated as *proof of inbox control*, which is a weaker claim than *proof of
  identity*. That is why it grants the ability to set a password (FR-019) but never a session
  (FR-021), and why it changes nothing else about the account (FR-017, FR-020).
- A Google-linked account gaining a password is an addition, not a conversion: feature 017's
  rule that linking must not alter an existing password credential is unaffected, and nothing
  about the Google sign-in path changes.
- The account page's password section reuses that page's existing shape: it sits beside the
  display-name section, submits on its own, and reports its own outcome, so neither section can
  block or clear the other. The page keeps its single address — no new view, no tabs.
- The account page can already tell whether the signed-in account has a password, so choosing
  between the two shapes of the section (FR-027 vs FR-031) needs no extra question of the user.

## Out of Scope

- Any second factor, security questions, backup codes, SMS, or recovery via a trusted contact.
- Operator- or admin-initiated password resets and any admin view of recovery activity.
- Notifying the account holder by email that their password *was* changed, by either route (a
  distinct message from the recovery link itself).
- Removing a password from an account, unlinking Google, or any other account-page control
  beyond the password section itself.
- Compromised-password (breach corpus) checking, password strength meters, and password expiry.
- Changing the account's email address, or recovery for someone who has lost their inbox.
- Any change to registration, sign-in, email verification, Google sign-in, roles, or account
  administration beyond the sign-in form's new "Forgot password?" control and the account page's
  new password section.
