# Feature Specification: Sign In / Sign Up with a Google Account

**Feature Branch**: `017-google-oauth-login`

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "lets add login/register by google account"

## Overview

Today the only way into Ladybug is the email + password pair introduced in feature 007
(register → verify email → sign in). This feature adds a **second, equal front door**:
a visitor can create an account and sign in using their existing Google account, in one
step, without choosing a password and without waiting for a verification email.

The existing email/password path stays exactly as it is. Nothing about roles (009),
rating and auto-activation (011), account disabling (012), or the verified-email gate on
uploading (008) and commenting (015) changes — a Google-created account is an ordinary
Ladybug account that happens to sign in a different way. The one place the two paths meet
is when a Google account's email address already belongs to a Ladybug account; that
meeting point is the security-sensitive core of this feature and is specified explicitly
below.

## Clarifications

### Session 2026-07-29

- Q: In-house implementation vs. adding a social-login package (e.g. `laravel/socialite`)? → A: In-house, no new dependency — server-side authorization-code flow using the HTTP client already present.
- Q: Email the account owner when a Google link is auto-attached to their pre-existing account? → A: No — no notification email in this feature; the account view's sign-in-method text is the only signal.
- Q: What happens when an already signed-in visitor starts the Google flow? → A: No-op and redirect — the flow does not start; the visitor is sent where signed-in visitors are already sent from the login view (the home feed).
- Q: What happens to the Google link when an admin hard-deletes the account (feature 013)? → A: Cascade — the link is deleted with the account, so the person can sign in with Google afterwards and get a fresh account like any new visitor.
- Q: For a disabled account, does the refusal run before or after auto-linking? → A: Refuse first, write nothing — eligibility is evaluated before any link or account is created, so a refused sign-in leaves no trace.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account with Google (Priority: P1)

A visitor who has never used Ladybug opens the register (or login) page, chooses
"Continue with Google", approves the request at Google, and returns to Ladybug already
signed in with a brand-new account. They never pick a password, never receive a
verification email, and can upload and comment immediately because Google has already
confirmed the address belongs to them.

**Why this priority**: This is the feature. It removes the two highest-friction steps of
the current sign-up funnel (choosing a password, leaving the site to click a verification
link) and everything else in this spec is either the returning-visit half of it or a
guard around it.

**Independent Test**: With no matching account in the system, complete the Google flow
end to end and confirm exactly one new account exists, that it is signed in, that it is
treated as email-verified, and that it can immediately perform a verified-only action
(post a comment). Confirm the account carries the ordinary defaults: member role, the
standard public account identifier, not disabled.

**Acceptance Scenarios**:

1. **Given** a visitor with no Ladybug account, **When** they choose "Continue with
   Google" and approve at Google, **Then** exactly one account is created using the name
   and email Google supplies, and the visitor returns to Ladybug signed in as that
   account.
2. **Given** that newly created account, **When** the system evaluates the
   verified-email gate, **Then** the account counts as verified and may upload and
   comment without any further email step.
3. **Given** that newly created account, **When** its attributes are inspected, **Then**
   it holds the ordinary defaults for a new account (member role, starting rating, a
   fresh public account identifier, not disabled) — the Google path grants no elevated
   standing.
4. **Given** a visitor who completes the Google flow, **When** they return to Ladybug,
   **Then** they land on the page they started from (or the home feed if there was no
   such page), not on a dead-end callback screen.

---

### User Story 2 - Sign in again with Google (Priority: P1)

A visitor who previously created their account with Google returns days later, chooses
"Continue with Google", and is signed straight back into the *same* account — same
uploads, same comments, same standing — with no second account created.

**Why this priority**: An account you can create but not return to is worthless.
Together with US1 this is the minimum shippable slice.

**Independent Test**: Complete US1, sign out, complete the Google flow again with the
same Google account, and confirm the visitor is signed in as the *same* account (same
public identifier, same uploads) and that the total account count did not increase.

**Acceptance Scenarios**:

1. **Given** an account previously created via Google, **When** the same person signs in
   with Google again, **Then** they are signed in as that same existing account and no
   new account is created.
2. **Given** that account, **When** the person has since changed their display name or
   email address at Google, **Then** they are still recognised as the same Ladybug
   account — recognition does not depend on the email address alone.
3. **Given** a signed-in Google-created account, **When** the person signs out, **Then**
   the session ends exactly as it does for a password account, and protected views are
   no longer reachable.
4. **Given** a Google-created account, **When** the person refreshes any signed-in view,
   **Then** the signed-in state is restored from the existing session with no repeat trip
   to Google.

---

### User Story 3 - Google address that already belongs to a Ladybug account (Priority: P1)

Someone registered with email + password months ago. Today they click "Continue with
Google" using that same address. The system recognises them as the **existing** account,
attaches the Google link to it, and signs them in — one account, now reachable through
either door. It never creates a second account on the same address, and it never touches
their password.

**Why this priority**: This is the account-takeover surface of the whole feature and the
one collision the existing unique-email rule cannot resolve on its own. It is P1 because
shipping US1/US2 without a defined answer here would leave the system either broken (a
unique-constraint failure the visitor sees as a crash) or unsafe.

**Independent Test**: Create a password account with a known address, then run the Google
flow with a Google account bearing that same address, and confirm the visitor is signed in
as that existing account, that the account count is unchanged, that the link is now stored,
and that the account's password still works unchanged at the password form.

**Acceptance Scenarios**:

1. **Given** an existing Ladybug account whose email matches the Google-confirmed address
   Google supplies, **When** the Google flow completes, **Then** the Google link is
   attached to that existing account, the visitor is signed in as it, and no second account
   is created.
2. **Given** that same collision, **When** the flow completes, **Then** the existing
   account's password credential is left untouched — it neither stops working nor becomes
   guessable — and the account's role, rating, uploads, and comments are unchanged. The
   person may afterwards sign in either way.
3. **Given** an account that was linked to Google by this rule, **When** the person later
   signs in with Google again, **Then** they are recognised by the stored link (US2), not
   re-resolved through the email collision path.
4. **Given** an existing account that has **not** yet verified its email address, **When**
   the same Google-confirmed address arrives, **Then** it is auto-linked on the same rule
   and the address ends up verified — Google's confirmation is the proof our own
   verification email was waiting for.
5. **Given** an existing account whose address matches but which Google reports as **not**
   confirmed, **When** the flow is processed, **Then** it is refused before any linking
   occurs (FR-005) — auto-linking rests entirely on Google having proven ownership of the
   address.
6. **Given** an existing account that is already linked to a *different* Google account,
   **When** a second Google account bearing the same address arrives, **Then** the flow is
   refused rather than moving or duplicating the link (FR-012).

---

### User Story 4 - The Google flow does not complete (Priority: P2)

The visitor changes their mind at Google's consent screen, or Google is unreachable, or
the return trip is tampered with or arrives stale. In every one of these cases the visitor
comes back to a normal Ladybug page with a plain-language message and an obvious way to
try again or use email and password instead — never a blank page, a raw error, or a
half-created account.

**Why this priority**: These paths are common (people do cancel) and are where a weak
implementation leaks security holes. They are P2 only because US1–US3 must exist first to
have something to fail.

**Independent Test**: Drive each failure — deny consent, return with a missing/mismatched
flow token, return with a stale flow token, simulate an unreachable provider — and confirm
each lands on a real page with a clear message, leaves the visitor signed out, and creates
no account.

**Acceptance Scenarios**:

1. **Given** a visitor at Google's consent screen, **When** they decline or cancel,
   **Then** they return to the sign-in page with a neutral "sign-in was cancelled"
   message, remain signed out, and no account is created.
2. **Given** a return from Google whose flow token is missing, altered, or does not match
   the one this browser started with, **When** it is processed, **Then** it is rejected
   outright, the visitor stays signed out, and no account is created or signed in.
3. **Given** a return from Google that arrives long after the flow started, or a return
   that is replayed a second time, **When** it is processed, **Then** it is rejected as
   expired/already-used rather than signing anyone in.
4. **Given** Google is unreachable or answers with an error, **When** the visitor attempts
   the flow, **Then** they see a distinct retryable message (not a validation-style error)
   and the email/password form remains available.
5. **Given** a visitor who double-clicks "Continue with Google" or reloads the return URL,
   **When** the requests are processed, **Then** at most one account is created and at
   most one session is established.

---

### User Story 5 - A disabled or ineligible account cannot slip in through Google (Priority: P2)

An account an administrator disabled (feature 012) stays out, whichever door it knocks on.
Signing in with Google gives exactly the same refusal as signing in with a password, and
grants no route around the moderation and role rules.

**Why this priority**: Access revocation that only covers one of two front doors is not
access revocation. It rides on US2/US3 but must ship with them.

**Independent Test**: Disable a Google-linked account, run the Google flow, and confirm
the refusal message and status match the password path's disabled-account refusal, that
no session is established, and that the account's disabled state is unchanged.

**Acceptance Scenarios**:

1. **Given** a disabled account linked to Google, **When** the person completes the Google
   flow, **Then** they are refused with the same "this account is disabled" outcome as the
   password path and no session is established.
2. **Given** any account signed in via Google, **When** it requests a role-restricted view
   or action, **Then** the existing role rules decide the outcome exactly as they do for a
   password session — Google sign-in confers no role.
3. **Given** an account that was hard-deleted while its Google flow was in progress,
   **When** the flow returns, **Then** the visitor is treated as a new visitor under the
   US1 rules rather than being signed into a missing account or shown an error.
4. **Given** a **disabled** account that is not yet linked, whose address arrives from
   Google for the first time, **When** the flow completes, **Then** it is refused before any
   linking occurs — no link is stored, no account is created, and the account is left exactly
   as the administrator left it.
5. **Given** that same account after an administrator re-enables it, **When** the person
   signs in with Google, **Then** the auto-link proceeds normally under the US3 rules — the
   earlier refusal left nothing behind to interfere.

---

### User Story 6 - The Google option is visible, accessible, themed, and responsive (Priority: P3)

The "Continue with Google" control appears on both the login and register pages, clearly
separated from the email/password form so neither path looks like a prerequisite of the
other. It is keyboard-operable, labelled for assistive technology, follows the site's
light/dark preference, and reflows cleanly from a narrow phone to a wide desktop. A signed-
in visitor can see, on their account page, how their account signs in.

**Why this priority**: These are baseline constitutional qualities layered over the other
stories; the feature works without them but does not ship without them.

**Independent Test**: Render both pages from ~320px to wide desktop in light and dark and
confirm no horizontal scroll, clipping, or overlap; reach and activate the control by
keyboard alone; confirm its accessible name states the action; confirm the account page
names the sign-in method in text.

**Acceptance Scenarios**:

1. **Given** the login or register page at any width from ~320px through wide desktop,
   **When** it renders, **Then** the Google control and the email/password form both
   reflow without horizontal scrolling, clipping, or overlap, and the control meets touch
   target sizing on small screens.
2. **Given** a keyboard or screen-reader user on either page, **When** they traverse it,
   **Then** the Google control is reachable in a logical order and its accessible name
   states what it does; the visual separation between the two sign-in methods is conveyed
   by text as well as layout.
3. **Given** the system light or dark preference, **When** either page loads, **Then** the
   Google control follows it consistently with the rest of the site.
4. **Given** a signed-in visitor on the account page, **When** it renders, **Then** it
   states in text how the account signs in (Google, password, or both).
5. **Given** a visitor waiting on the Google round trip, **When** the request is in flight,
   **Then** a pending state is shown and repeat activation is prevented.

---

### Edge Cases

- **Consent declined**: Visitor cancels at Google → neutral message, signed out, no
  account created.
- **Flow token missing / altered / mismatched**: The return is rejected outright; nobody is
  signed in. (Guards against a forged sign-in being planted in a victim's browser.)
- **Stale or replayed return**: A return that arrives after the flow window, or a second
  time, is rejected rather than honoured.
- **Provider unreachable / provider error**: Distinct retryable message; the email/password
  form stays usable.
- **Google supplies no email address, or an address Google itself has not confirmed**: The
  flow is refused with a clear message rather than creating an account on an unproven
  address — the whole trust model of skipping our own verification step rests on Google
  having confirmed it.
- **Google address already on a Ladybug account**: Auto-linked to that existing account and
  signed in (US3); never a second account, never a unique-constraint crash shown to the
  visitor, never a change to the existing password.
- **Existing account already linked to a different Google account**: Refused rather than
  relinked, so a link can never be moved off an account by whoever signs in next.
- **Person's email changed at Google since linking**: They are still the same Ladybug
  account (recognition is by the stable provider identity, not the address). Whether the
  stored address follows the change is an explicit decision recorded in Assumptions.
- **Google name missing, empty, or longer than the display-name limit**: A usable display
  name is still produced (trimmed to the limit, or derived) rather than failing the sign-up.
- **Disabled account**: Same refusal as the password path (US5), and the refusal is evaluated
  before anything is written — a disabled account never acquires a link on a sign-in it was
  going to be refused.
- **Account hard-deleted mid-flow**: Treated as a new visitor, not an error.
- **Account hard-deleted, person returns later**: The link went with the account (FR-032), so
  the next Google sign-in creates a fresh account rather than being refused by the one-to-one
  rule against a stale link nobody can clear.
- **Double submit / reloaded return URL**: At most one account and one session (US4).
- **Refresh or Back on the return URL**: Lands on a real page — a signed-in visitor is not
  bounced through Google again, and Back does not re-trigger the flow.
- **Signed-in visitor starts the Google flow anyway**: No flow starts. The request is a
  no-op and the visitor is redirected to the home feed — the same destination the existing
  route guards already send a signed-in visitor to from the login view. No second account, no
  new link, and no silent swap of which account is signed in.
- **Sign-in attempts at volume**: The Google entry point is rate-limited comparably to the
  password login so it cannot be used to bypass that limit or to mass-create accounts.

## Requirements *(mandatory)*

### Functional Requirements

#### Entering and completing the flow

- **FR-001**: The system MUST offer "sign in with Google" as an entry point on both the
  login and the register view, and MUST keep the existing email/password path fully
  working and unchanged alongside it.
- **FR-002**: Starting the flow MUST redirect the visitor to Google for authentication and
  consent, requesting only the minimum information the feature needs: a stable identifier
  for the Google account, the email address and its confirmed status, and a display name.
- **FR-003**: The system MUST bind each started flow to the browser that started it with
  an unguessable, single-use, time-limited flow token, and MUST reject any return whose
  token is missing, altered, mismatched, expired, or already consumed — without signing
  anyone in and without creating an account.
- **FR-004**: The system MUST verify with Google that the returned credential is genuine
  and was issued for this application before trusting any attribute in it; attributes
  arriving from the browser MUST NOT be trusted on their own.
- **FR-005**: The system MUST refuse the flow, with a clear message and no account
  creation, when Google supplies no email address or reports the address as not confirmed
  by Google.
- **FR-006**: On success the system MUST establish an authenticated session equivalent in
  every respect to one established by password login, and MUST return the visitor to the
  page they started from, or the home feed when there was none.
- **FR-007**: A cancelled, failed, expired, or rejected flow MUST return the visitor to a
  normal Ladybug page with a plain-language, non-technical message and a way to retry or
  use email and password, leaving them signed out.
- **FR-008**: The Google entry point MUST be rate-limited comparably to the existing
  password login so it cannot be used to bypass that limit or to create accounts in bulk.
- **FR-031**: A request to start the Google flow from an **already authenticated** session
  MUST NOT start a flow. It MUST be a no-op that redirects the visitor to the home feed —
  the same destination the existing route guards send a signed-in visitor to from the login
  view — creating no account, attaching no link, and never replacing which account is signed
  in. (Numbered out of sequence deliberately: appended after clarification rather than
  renumbering the cross-referenced requirements above.)

#### Resolving which account the visitor is

- **FR-009**: The system MUST recognise a returning visitor by the **stable identifier
  Google assigns to their account**, not by their email address, so that a changed Google
  address still resolves to the same Ladybug account.
- **FR-010**: When no account is linked to that identifier and no account holds the
  supplied email address, the system MUST create exactly one new account from the supplied
  name and address and link it to that identifier.
- **FR-011**: When no account is linked to that identifier but an account already holds the
  supplied email address, the system MUST attach the link to that **existing** account and
  sign the visitor in as it — automatically, with no extra confirmation step — and MUST NOT
  create a second account on that address under any circumstances. This auto-link is
  conditional on FR-005: an address Google has not confirmed never reaches this rule.
- **FR-012**: Linking MUST be one-to-one in both directions: one Ladybug account links to at
  most one Google account, and one Google account links to at most one Ladybug account. An
  attempt that would violate either direction — most importantly, a Google account arriving
  for a Ladybug account that is already linked to a different one — MUST be refused with a
  clear message, and MUST NOT move, overwrite, or duplicate an existing link.
- **FR-013**: A newly created Google account MUST receive the ordinary defaults for a new
  account — the standard role, the standard starting rating, a fresh public account
  identifier of the project's standard form, and no disabled state. The Google path MUST
  NOT confer any elevated standing.
- **FR-014**: An account created or linked through a Google-confirmed address MUST be
  treated as having a verified email address, satisfying the existing verified-email gate
  on uploading and commenting with no further email step.
- **FR-015**: Linking MUST NOT alter the existing account's password credential, role,
  rating, uploads, comments, or disabled state.
- **FR-016**: A display name MUST always be produced, even when Google supplies none or
  supplies one exceeding the project's display-name limit.

#### Signing in with an existing account

- **FR-017**: A disabled account MUST be refused at the Google entry point with the same
  outcome the password path gives, and MUST NOT receive a session. This check MUST run
  **before** any linking or account creation, so a refused sign-in writes nothing: no link is
  attached to a disabled account, whether it was already linked or was matched by address for
  the first time. Re-enabling the account MUST let the next Google sign-in link normally.
- **FR-018**: Roles and permissions MUST apply to a Google-established session exactly as
  they do to a password-established session; the sign-in method MUST NOT influence any
  authorization decision.
- **FR-019**: Signing out of a Google-established session MUST end it exactly as it ends a
  password session, and refreshing a signed-in view MUST restore the session without a
  repeat trip to Google.
- **FR-020**: An account with no password (created via Google) MUST NOT be signable-into by
  the password form — no empty, absent, or unset password may ever satisfy password login —
  and the attempt MUST produce the same non-disclosing failure as any other wrong
  credential, so the form does not reveal which accounts are Google-only.

#### Data, privacy, and security

- **FR-021**: The system MUST store, per linked account, only what recognition and support
  require: the provider name, the provider's stable account identifier, and when the link
  was made. Access and refresh credentials from the provider MUST NOT be retained beyond
  the sign-in exchange.
- **FR-022**: The provider's stable account identifier MUST NOT appear in any URL, any
  public API response, or any page the visitor's own account cannot see; it is internal,
  exactly like the database id.
- **FR-023**: Credentials identifying this application to Google MUST live only in
  environment configuration, never in committed source, with placeholders in the example
  environment file.
- **FR-024**: All data arriving from the provider MUST be validated and length-bounded
  before storage, and escaped for its context on output — a display name from Google is
  untrusted input like any other.
- **FR-025**: Existing accounts and existing sessions MUST be unaffected by this feature's
  deployment: a password account that never touches Google MUST behave exactly as before.
- **FR-032**: Deleting an account MUST delete its Google link with it, leaving no ownerless
  link behind. A person whose account was deleted MUST be able to sign in with Google again
  and receive a fresh account under the US1 rules — the deleted account's former link MUST
  NOT match, and MUST NOT cause the one-to-one rule (FR-012) to refuse them.

#### Presentation

- **FR-026**: The Google control MUST be visually and textually distinguished from the
  email/password form so neither reads as a prerequisite of the other, with the distinction
  conveyed by text and not by color or position alone.
- **FR-027**: The Google control MUST have an accessible name stating its action, MUST be
  fully keyboard-operable, and MUST show a pending state that prevents repeat activation
  while a round trip is in flight.
- **FR-028**: Both views MUST continue to follow the visitor's light/dark preference and to
  reflow across mobile, tablet, and desktop widths (~320px through wide desktop) with no
  horizontal scrolling, clipping, or overlap.
- **FR-029**: The account view MUST state in text how the account signs in (Google,
  password, or both).
- **FR-030**: Every view this feature touches MUST keep a real, shareable URL, and Back,
  Forward, and Refresh MUST behave natively — in particular, returning to or refreshing the
  post-Google return URL MUST NOT re-trigger the flow or strand the visitor.

### Key Entities *(include if feature involves data)*

- **User (existing)**: The Ladybug account. This feature adds the possibility that an
  account has **no password**, and adds a link to an external identity. Everything else —
  display name, unique email address, public account identifier, role, rating, verified
  state, disabled state — is unchanged and is not duplicated per sign-in method.
- **External identity link (new)**: The association between one Ladybug account and one
  Google account: the provider name, the provider's stable account identifier for that
  person, and when the link was created. It is the authoritative answer to "who is this
  returning visitor" and is never exposed publicly. Its lifetime is bounded by the account's:
  the link is created by the first Google sign-in and **destroyed with the account** on a
  hard delete (FR-032) — unlike memes and comments, which orphan, a link with no owner has no
  meaning and would wrongly block its person from ever signing up again.
- **Sign-in flow state (new, transient)**: The short-lived, single-use, browser-bound token
  that ties a return from Google to the flow that started it, plus where to send the visitor
  afterwards. It exists only for the duration of one attempt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor with a Google account can go from the login page to a signed-in
  Ladybug account in under 30 seconds and without typing a password, in 100% of attempts
  where they approve at Google.
- **SC-002**: A first-time Google sign-up creates exactly one account and requires zero
  email round trips before the visitor can upload or comment — a 2-step reduction against
  the password path (choose password, click verification link).
- **SC-003**: Repeat Google sign-ins resolve to the same account 100% of the time,
  including after the person changes their name or email address at Google, and never
  increase the account count.
- **SC-004**: In 100% of cases where a Google-confirmed address already belongs to a Ladybug
  account, the visitor is signed in as that existing account, the account count is unchanged,
  and the existing account's password still works at the password form afterwards with its
  role, rating, uploads, and comments untouched.
- **SC-005**: 100% of cancelled, expired, replayed, tampered, and provider-error returns
  leave the visitor signed out with no account created, and land on a real page carrying a
  plain-language message — zero blank pages, raw errors, or partial accounts.
- **SC-006**: 100% of disabled accounts are refused at the Google entry point with the same
  outcome as at the password entry point, and 100% of those refusals leave the account
  byte-for-byte unchanged — no link written, no account created.
- **SC-007**: No password-only account's behaviour changes: 100% of existing password
  sign-in, registration, verification, upload, and comment flows still pass after this
  feature ships.
- **SC-008**: No account can be signed into by the password form without a real password,
  verified across accounts that have never had one; and the password form's failure message
  is indistinguishable between "wrong password" and "this account has none".
- **SC-009**: The provider's account identifier appears in zero URLs and zero public API
  responses, verified across every endpoint this feature touches.
- **SC-010**: Both the login and register views render with no horizontal scrolling,
  clipping, or overlap at representative mobile, tablet, and desktop widths, in both light
  and dark, and the Google control is reachable and operable by keyboard alone on both.
- **SC-011**: Code added by this feature keeps total line coverage at or above 90% on both
  stacks (constitutional test gate), covering the happy paths and every edge case listed
  above.

## Assumptions

- **Google is the only provider in this feature.** The stored link records which provider it
  came from so a second provider could be added later, but no other provider is designed,
  built, or exposed here.
- **Google's own confirmation of the address is what replaces our verification email.** An
  address Google has not confirmed is refused outright (FR-005) rather than falling back to
  our email verification, keeping the trust story simple: either Google vouched for it or the
  visitor uses the password path.
- **Recognition is by Google's stable account identifier, not by email.** The address is used
  only on the very first encounter, to detect the collision with an existing account
  (FR-011).
- **A collision with an existing account auto-links rather than refusing** (decision recorded
  2026-07-29). Google having confirmed the address is treated as sufficient proof of
  ownership, which is also what our own verification email proves — so requiring a password
  as well would add friction without adding a guarantee. Refusing instead would be a genuine
  dead end for anyone who has forgotten they ever registered, because password reset is
  unbuilt project-wide. The safety of this rests on two guards that MUST hold together:
  FR-005 (an address Google has not confirmed never reaches the linking rule) and FR-012
  (an account already linked elsewhere is refused, so a link can never be relinked away).
  **The auto-link is silent** (decision recorded 2026-07-29): no email tells the owner a
  second way in now exists. The residual risk is accepted because auto-linking only ever
  fires on an address Google has confirmed, and the account view's sign-in-method text
  (FR-029) is treated as sufficient disclosure. Nothing in this feature sends mail.
- **The stored email address does not silently follow changes made at Google.** The address
  on file stays as it was when the account was created or linked; keeping it in step is
  deferred, because rewriting it would have to contend with the unique-address rule and could
  collide with another Ladybug account.
- **Google-created accounts have no password and no way to set one in this feature.**
  Password reset is still unbuilt for the whole project; giving Google accounts a password is
  deferred with it. Such an account signs in with Google.
- **Explicitly linking or unlinking Google from the account page is out of scope.** Linking
  happens only as a consequence of signing in (FR-011); managing it afterwards is a separate
  feature.
- **The existing site layout, theming, responsive behaviour, session mechanism, role rules,
  rating rules, and disabled-account rules are reused unchanged** — this feature adds a door,
  not a second building.
- **Configuring the application's registration with Google** (obtaining client credentials,
  registering redirect URLs for local, e2e, and production) is a deployment prerequisite,
  carried in environment configuration and documented in the deployment runbook, not in
  committed source.
- **No new dependency: the flow is implemented in-house** (decision recorded 2026-07-29).
  The redirect to Google and the exchange of the returned authorization code are written
  against Google's documented endpoints using the HTTP client the stack already ships — no
  social-login package, and no third-party script loaded into the browser. This is
  tractable to hand-roll specifically because the code exchange is a direct server-to-server
  TLS call authenticated with the application's own client secret, so its response is
  trustworthy without implementing token-signature verification, key fetching, or key
  rotation (FR-004). Should planning uncover a reason this cannot hold, a package would be a
  fresh Principle I decision requiring written rationale and explicit approval **before**
  installation.
- **Existing password accounts remain the majority path.** Nothing about this feature
  deprecates, discourages, or migrates them.

## Out of Scope

- Any identity provider other than Google (Facebook, GitHub, Apple, generic OpenID).
- Setting, changing, or resetting a password on a Google-created account; password reset
  generally (still unbuilt project-wide).
- Explicit link/unlink management of the Google connection from the account page.
- Any email sent by this feature — in particular, notifying an account owner that a Google
  sign-in method was auto-attached to their existing account. This feature sends no mail.
- Reading anything from Google beyond identity basics — no contacts, no Drive, no calendar,
  no profile picture import, no ongoing API access after sign-in.
- Keeping the stored display name or email address in step with later changes at Google.
- One-tap / embedded Google sign-in prompts, or Google sign-in from anywhere other than the
  login and register views.
- Multiple simultaneous external identities on one account, or account merging beyond the
  single linking rule in US3.
- Admin-facing views of which accounts are Google-linked, and any change to the admin
  consoles.
- Two-factor authentication, "remember me", and session-lifetime changes.

## Dependencies

- **Feature 007 (auth UI + Sanctum session)** — the session mechanism this feature
  establishes, the login/register/account views it extends, and the non-disclosing failure
  behaviour it must match.
- **Feature 008 (email verification)** — the verified-email gate that Google-confirmed
  addresses satisfy directly.
- **Feature 009 (roles)** — the role defaults and authorization rules a Google session obeys
  unchanged.
- **Feature 011 (rating / auto-activation)** — the starting rating a new Google account
  receives, unchanged.
- **Feature 012 (account disabling)** — the refusal this feature must reproduce at the Google
  entry point.
- **Google's identity service** — an external dependency: its availability determines whether
  this entry point works at any given moment, which is why FR-007 keeps the password path
  visible and usable at all times.
