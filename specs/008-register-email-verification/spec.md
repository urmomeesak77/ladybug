# Feature Specification: Registration Email Verification

**Feature Branch**: `008-register-email-verification`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Registering should use validation as well. check prototype how validating by email is implemented"

## Clarifications

### Session 2026-07-07

- Q: After successful registration, where does the user land to see the "check
  your email inbox" message (naming their address)? → A: A dedicated
  verification-notice page with its own URL, showing the message and offering
  the resend action.
- Q: How long should a verification link remain valid before it expires? →
  A: 24 hours.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify a new account via email (Priority: P1)

A visitor registers a new account. The site tells them to check their email
inbox for a verification message addressed to them. The message contains a
verification link; opening it marks their account as verified and shows a clear
confirmation. Until then the account exists but is recorded as unverified.

**Why this priority**: This is the core of the feature — proving that the
person registering actually controls the email address they gave. Every other
story builds on the verification record this one creates.

**Independent Test**: Register a fresh account, capture the outgoing
verification message, open the link it contains, and confirm the account's
status changes from unverified to verified and the user sees a confirmation.

**Acceptance Scenarios**:

1. **Given** a visitor on the registration form with valid details, **When**
   they submit the form successfully, **Then** their account is created as
   unverified, a verification message is sent to the registered address, and
   they land on a dedicated verification-notice page (with its own URL) telling
   them to check that inbox (naming the address) and offering a resend.
2. **Given** a registered but unverified user who received the verification
   message, **When** they open the verification link, **Then** their account is
   marked verified (with the time of verification recorded) and they see a page
   confirming the verification.
3. **Given** an already verified user, **When** they open a verification link
   again, **Then** nothing changes and they are informed their account is
   already verified (no error, no duplicate effect).
4. **Given** a user who opens their verification link in a browser where they
   are not signed in, **When** they sign in with that account, **Then** the
   verification completes rather than being lost.

---

### User Story 2 - Request a new verification message (Priority: P2)

A registered user never received the verification message (or their link
expired). From the site they request a fresh verification message and complete
verification with the new link.

**Why this priority**: Email delivery is unreliable and links expire; without a
resend path a user who misses the first message can never verify. It depends on
Story 1's flow existing.

**Independent Test**: Register an account, discard the first message, trigger a
resend, and verify using the newly delivered link.

**Acceptance Scenarios**:

1. **Given** a signed-in unverified user, **When** they request a new
   verification message, **Then** a fresh message is sent to their address and
   the site confirms it was sent.
2. **Given** an unverified user whose link has expired, **When** they open the
   expired link, **Then** the account is not verified, they see a clear
   explanation, and they are offered a way to request a new message.
3. **Given** a user who repeatedly requests resends, **When** they exceed the
   allowed rate, **Then** further requests are refused with a clear message
   until the rate window passes.

---

### User Story 3 - See verification status on the account page (Priority: P3)

A signed-in user visits their account page and can see whether their email
address is verified. If it is not, the page offers the resend action.

**Why this priority**: Visibility closes the loop — users can check where they
stand and reach the resend action without support. It is a convenience layer
over Stories 1 and 2.

**Independent Test**: Sign in as an unverified user and confirm the account
page states the address is unverified and offers a resend; verify the account
and confirm the page now states it is verified.

**Acceptance Scenarios**:

1. **Given** a signed-in unverified user, **When** they open their account
   page, **Then** the page states their email is not yet verified (not by
   color alone) and offers to send a new verification message.
2. **Given** a signed-in verified user, **When** they open their account page,
   **Then** the page states their email is verified and shows no resend action.

---

### Edge Cases

- Verification link is tampered with (altered address, identifier, or
  signature): verification is refused and nothing about the account changes.
- Verification link has expired: verification is refused with a clear message
  and a path to request a fresh link.
- The verification message cannot be dispatched at registration time: the
  account is still created and the user can request a resend later —
  registration never fails because of email delivery.
- Several verification messages were requested: any still-valid link verifies
  the account; using a second link after verification is harmless.
- A signed-in user opens a verification link that belongs to a different
  account: verification is refused.
- Accounts created before this feature exists: they count as unverified and can
  verify through the resend path at any time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On successful registration the system MUST record the new account
  as unverified and send a verification message to the registered email
  address.
- **FR-002**: Each verification message MUST contain a link that is unique to
  the account, tamper-evident (any alteration invalidates it), and
  time-limited: it expires 24 hours after being sent.
- **FR-003**: Opening a valid verification link MUST mark the account as
  verified, record when verification happened, and show the user a
  confirmation.
- **FR-004**: An expired, altered, or otherwise invalid link MUST NOT verify
  the account; the user MUST see a clear explanation and a way to request a
  new verification message.
- **FR-005**: Verification MUST be idempotent: re-opening a link for an already
  verified account changes nothing and informs the user they are already
  verified.
- **FR-006**: Signed-in unverified users MUST be able to request a new
  verification message, and such requests MUST be rate-limited to prevent
  abuse.
- **FR-007**: Immediately after registering, the user MUST land on a dedicated
  verification-notice page with its own URL that tells them to check their
  email for the verification message (naming the registered address) and
  offers the resend action.
- **FR-008**: The account page MUST show the user's verification status and,
  when unverified, offer the resend action; status MUST NOT be conveyed by
  color alone and all controls MUST be labeled accessibly.
- **FR-009**: Verification MUST NOT restrict what users can already do today
  (signing in, browsing, viewing their account); the recorded status exists so
  future contribution features (uploads, comments) can require a verified
  account.
- **FR-010**: The pages a user lands on during verification (the
  post-registration notice, confirmation, failure/expired) MUST have real
  shareable URLs that survive refresh and Back/Forward navigation.
- **FR-011**: Registration MUST succeed even when the verification message
  cannot be dispatched; the failure MUST NOT expose account creation errors to
  the registrant beyond the normal registration outcome.

### Key Entities

- **User account**: An existing registered identity, extended with a
  verification state — either unverified or verified at a recorded moment in
  time.
- **Verification link**: A single-purpose, account-bound, expiring token of
  proof delivered by email; usable any number of times but effective only once
  (subsequent uses are no-ops).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new registrant receives the verification message within 1
  minute of completing registration.
- **SC-002**: A user can go from submitting the registration form to a verified
  account in under 2 minutes (excluding inbox delivery delays outside the
  system's control).
- **SC-003**: 100% of altered or expired verification links are rejected
  without changing any account's status.
- **SC-004**: An account's verification status is accurate at all times: it is
  unverified from creation until a valid link is used, and verified from that
  moment on.
- **SC-005**: Resend requests beyond the allowed rate are refused, and a user
  who was refused can succeed again after the rate window passes.
- **SC-006**: 95% of users who open a valid verification link reach the
  confirmation without assistance on the first attempt.

## Assumptions

- The prototype's behavior is the reference: registration signs the user in
  immediately, and unverified users are not blocked from signing in or
  browsing. Nothing on the site requires a verified account yet — enforcement
  arrives with future contribution features (uploads, comments).
- Verification links expire after 24 hours (clarified 2026-07-07); an expired
  link is recoverable via resend.
- Resend requests are rate-limited to roughly 6 per minute per user, matching
  the prototype's throttle.
- Email delivery infrastructure is available in every environment (development
  uses a local capture/log destination; the choice is an implementation
  detail).
- Changing the registered email address and password reset are out of scope —
  neither feature exists yet.
- Pre-existing accounts (seeded or created under feature 007) are treated as
  unverified and can verify via the resend path; they lose no current
  capability.
