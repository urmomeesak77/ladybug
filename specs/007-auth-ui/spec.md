# Feature Specification: Authentication (Full-Stack — Auth API + Login/Register/Account UI)

**Feature Branch**: `007-auth-ui`

**Created**: 2026-06-19

**Status**: Draft

**Input**: User description: "Auth UI: login, register, and account pages for the React frontend, consuming the backend Sanctum auth API (register / login / logout / current-user). Mirror the prototype's LoginPage, RegisterPage, and AccountPage; real shareable URLs (/login, /register, /account) with Back/Forward/Refresh restore; redirect rules; accessible, themed, responsive forms; inline server-side validation."

## Overview

This feature adds end-user authentication to Ladybug as a single full-stack slice:
the backend gains a Sanctum-backed auth API (register, login, logout, current-user)
and the frontend gains the three pages that drive it — register, login, and a
logged-in account view — wired into the existing site layout and navigation.

Until now the backend exposed only the read-side feed (`TrashpostsApiController`);
there is no `AuthController`, no auth routes, and no auth UI. The earlier prototype
(`C:\projects\trash`) already implemented this once — `AuthController` with
`register`/`login`/`logout`/`user`, `RegisterRequest`/`LoginRequest` validation, a
`UserResource`, and React `LoginPage`/`RegisterPage`/`AccountPage` — and is the
parity reference for fields, flows, and validation behavior. Where the prototype
conflicts with the Ladybug Constitution or `docs/CODING_CONVENTIONS.md`, the latter
win.

This slice delivers the foundation that uploading and commenting will later build
on (those features need a logged-in user), but it does not itself add uploading,
commenting, password reset, or email verification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a new account (Priority: P1)

A visitor opens the register page, enters a name, email, and password (with
confirmation), submits, and becomes a logged-in user — landing back on the site as
themselves. If their input is rejected (e.g. email already taken, weak password,
mismatched confirmation), they see clear per-field messages and can correct and
resubmit without losing context.

**Why this priority**: Without registration there are no accounts; every other auth
flow and every future logged-in feature depends on it. It is the foundational slice.

**Independent Test**: Against the API, POST valid registration data and confirm a
user is created and an authenticated session/token is established and the
current-user endpoint then returns that user; in the UI, complete the register form
with valid data and confirm arrival in a logged-in state, and with invalid data
confirm inline field errors and no account creation.

**Acceptance Scenarios**:

1. **Given** a visitor on the register page, **When** they submit a unique email, a
   name, and a valid matching password pair, **Then** an account is created, they
   become authenticated, and the UI reflects the logged-in state.
2. **Given** an email already registered, **When** the visitor submits it, **Then**
   registration is rejected with a clear "email already in use" message tied to the
   email field, and no duplicate account is created.
3. **Given** a password that fails policy (too short, or missing required character
   variety) or a confirmation that does not match, **When** the visitor submits,
   **Then** the relevant field shows a clear validation message and the account is
   not created.
4. **Given** a visitor who just registered, **When** the page settles, **Then** the
   navigation reflects the authenticated state (account reachable, register/login no
   longer offered).

---

### User Story 2 - Log in and log out (Priority: P1)

A returning visitor opens the login page, enters their email and password, and is
authenticated. Wrong credentials produce a single clear error without revealing
whether the email or the password was wrong. A logged-in user can log out, ending
their session and returning the site to its anonymous state.

**Why this priority**: Login/logout is the other half of the core auth loop and is
equally foundational; registration without a way to return is incomplete.

**Independent Test**: Against the API, POST correct credentials and confirm an
authenticated session/token is established; POST wrong credentials and confirm a 401
with a non-disclosing message; POST to logout and confirm the session/token is
revoked. In the UI, log in with valid and invalid credentials and confirm the
respective outcomes, then log out and confirm the anonymous state returns.

**Acceptance Scenarios**:

1. **Given** a registered user on the login page, **When** they submit correct
   credentials, **Then** they become authenticated and the UI reflects the
   logged-in state.
2. **Given** an incorrect email or password, **When** the visitor submits, **Then**
   a single clear error is shown that does not disclose which of the two was wrong,
   and the visitor remains unauthenticated.
3. **Given** a logged-in user, **When** they choose to log out, **Then** their
   session/token is revoked, the UI returns to the anonymous state, and protected
   views are no longer accessible.
4. **Given** an unauthenticated visitor, **When** the current-user endpoint is
   queried, **Then** it reports no authenticated user rather than erroring opaquely.

---

### User Story 3 - View the account page (Priority: P2)

A logged-in user opens the account page and sees their own profile details (at least
their name and email) and a way to log out. The page is reachable by its own URL and
survives a refresh while the session is valid.

**Why this priority**: The account view is the visible payoff of being logged in and
the home for logout, but it depends on US1/US2 establishing a session first.

**Independent Test**: While authenticated, open `/account` directly and confirm the
user's own name and email render and a logout control is present; refresh and confirm
the same content returns from the URL alone.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **When** they open the account page, **Then** their
   own name and email are displayed along with a logout control.
2. **Given** a logged-in user on the account page, **When** they refresh, **Then**
   the same account content is restored from the URL while the session is valid.
3. **Given** a user whose session has ended (logged out or expired), **When** they
   are on or open the account page, **Then** they are sent to the login view rather
   than shown stale or empty account data.

---

### User Story 4 - Deep-linkable auth routes with redirect rules (Priority: P2)

Each auth view has a real shareable URL (`/login`, `/register`, `/account`).
Logged-out visitors who open `/account` are redirected to `/login`; logged-in
visitors who open `/login` or `/register` are redirected to the home feed.
Back/Forward/Refresh behave natively throughout.

**Why this priority**: Browser-native navigation and deep linking are
constitutional requirements; the redirect rules prevent dead-end and nonsensical
states. It depends on the pages existing first.

**Independent Test**: Open each auth URL directly in a fresh tab in both
authenticated and anonymous states and confirm the correct view or redirect; use
Back/Forward across a login transition and confirm sane restoration; refresh each
view and confirm it restores from the URL.

**Acceptance Scenarios**:

1. **Given** an anonymous visitor, **When** they open `/account` directly, **Then**
   they are redirected to `/login`.
2. **Given** a logged-in visitor, **When** they open `/login` or `/register`
   directly, **Then** they are redirected to the home feed.
3. **Given** a visitor on any auth view, **When** they refresh, **Then** the correct
   view (or its redirect) is restored from the URL alone.
4. **Given** a visitor who navigates between auth views and the feed, **When** they
   press Back/Forward, **Then** the views restore in the expected order without
   broken or duplicated state.

---

### User Story 5 - Accessible, themed, responsive auth forms (Priority: P3)

Every auth form is usable on phone, tablet, and desktop, follows the system
light/dark preference, and is fully operable with keyboard and assistive technology:
labeled inputs, errors announced and not signalled by color alone, adequate touch
targets.

**Why this priority**: These are baseline constitutional qualities applied across all
three pages; they enhance the other stories rather than standing alone.

**Independent Test**: View each form at narrow/medium/wide widths and confirm no
horizontal scroll, clipping, or overlap; toggle OS light/dark and confirm the theme
follows; traverse each form by keyboard and confirm labels, focus order, and
error association; confirm errors carry a non-color cue (text/icon), not color only.

**Acceptance Scenarios**:

1. **Given** any viewport from ~320px through wide desktop, **When** an auth form
   renders, **Then** it reflows with no horizontal scrolling, clipping, or overlap,
   and controls keep adequate touch target size.
2. **Given** the system is set to dark (or light) mode, **When** an auth page loads,
   **Then** its appearance follows that preference, consistent with the rest of the
   site.
3. **Given** a keyboard or screen-reader user, **When** they traverse a form,
   **Then** every input has an associated label, validation errors are programmatically
   associated with their fields and conveyed by text (not color alone), and focus
   order is logical.

---

### Edge Cases

- **Duplicate email**: Registration with an existing email is rejected with a
  field-level message; no second account is created.
- **Weak / mismatched password**: A password failing the strength policy, or a
  confirmation mismatch, is rejected with a clear field-level message.
- **Wrong credentials**: Login failure returns one non-disclosing error (not "no such
  email" vs "wrong password") to avoid account enumeration.
- **Already authenticated**: Hitting `/login` or `/register` while logged in
  redirects to the feed rather than showing a redundant form.
- **Protected route while anonymous**: Hitting `/account` while logged out redirects
  to `/login`, not a blank or error page.
- **Expired / revoked session**: A request with a stale token is treated as
  unauthenticated; the UI degrades to the anonymous state and protected views
  redirect to login rather than showing stale data.
- **Double submit**: Submitting a form twice (or while a request is in flight) does
  not create duplicate accounts or duplicate sessions; the control is guarded while
  pending.
- **Server/network failure**: A transient failure during submit shows a clear,
  retryable error distinct from validation errors, without losing entered field
  values (except passwords).
- **Refresh mid-session**: Refreshing any authenticated view re-establishes the
  logged-in UI from the existing session without forcing a re-login.

## Requirements *(mandatory)*

### Functional Requirements

#### Backend — Auth API

- **FR-001**: The system MUST expose a registration endpoint that accepts a name,
  an email, and a password with confirmation; on success it MUST create exactly one
  user, establish an authenticated session/credential, and return the new user's safe
  profile (id, name, email, timestamps) without ever returning the password hash.
- **FR-002**: Registration input MUST be validated server-side: name required (bounded
  length); email required, well-formed, and unique among users; password required and
  meeting a strength policy (minimum length with character-variety requirements) and
  matching its confirmation. Validation failures MUST return structured per-field
  errors.
- **FR-003**: The system MUST expose a login endpoint that accepts email and password,
  establishes an authenticated session/credential on success, and on failure returns
  an unauthorized result with a single message that does NOT disclose whether the
  email or the password was the cause.
- **FR-004**: The system MUST expose a logout endpoint that revokes the current
  authenticated session/credential so subsequent protected requests are rejected.
- **FR-005**: The system MUST expose a current-user endpoint that returns the
  authenticated user's safe profile when authenticated and clearly indicates "no
  authenticated user" otherwise (rather than an opaque error).
- **FR-006**: Auth endpoints that change state or read user-specific data MUST be
  protected by the project's authentication mechanism (Sanctum) and MUST follow the
  constitution's security rules: no secrets in code, parameterized data access, output
  escaped/encoded per context, passwords stored only as secure hashes.
- **FR-007**: Public profile output MUST exclude sensitive fields (password hash,
  remember tokens); only id, name, email, and timestamps are exposed.

#### Frontend — Auth UI

- **FR-008**: The frontend MUST provide a register view at `/register`, a login view
  at `/login`, and an account view at `/account`, each a real shareable URL within the
  existing site layout (header, navigation), consistent with the home and post pages.
- **FR-009**: The register and login forms MUST submit to the auth API and reflect the
  result: on success transition the app to the authenticated state; on validation
  failure show server-provided errors inline next to the relevant fields; on transient
  failure show a distinct retryable error.
- **FR-010**: The account view MUST display the logged-in user's own name and email
  and provide a logout control that ends the session and returns the app to the
  anonymous state.
- **FR-011**: The app MUST track authentication state and reflect it in navigation:
  anonymous users see register/login affordances; authenticated users see an account
  affordance and a way to log out, and not the register/login affordances.
- **FR-012**: Route guards MUST enforce: anonymous access to `/account` redirects to
  `/login`; authenticated access to `/login` or `/register` redirects to the home
  feed; an ended/expired session on a protected view redirects to `/login`.
- **FR-013**: Browser Back, Forward, and Refresh MUST behave natively across auth
  views: refreshing any view restores it (or its redirect) from the URL alone, and a
  valid existing session is re-detected on load so authenticated views do not force a
  spurious re-login.
- **FR-014**: Auth state MUST be derived from the backend (e.g. the current-user
  endpoint) on load rather than trusting client-only flags, so a stale client cannot
  present a logged-in UI without a valid session.

#### Cross-cutting — Accessibility, theming, responsiveness, security

- **FR-015**: Every form input MUST have an associated `<label>`; validation errors
  MUST be programmatically associated with their field (e.g. `aria-*`) and conveyed by
  text (and/or icon), never by color alone.
- **FR-016**: All auth views MUST follow the visitor's `prefers-color-scheme`,
  consistent with the rest of the site; a manual theme override remains out of scope.
- **FR-017**: All auth views MUST adapt fluidly across mobile, tablet, and desktop
  widths (~320px through wide desktop) with no horizontal scrolling, clipped content,
  or overlap, and with adequate touch-target sizing on small screens.
- **FR-018**: Password fields MUST be masked, MUST NOT be retained in plaintext in
  app state beyond what submission requires, and MUST NOT be echoed back by the
  server or repopulated into the form on error.
- **FR-019**: Forms MUST guard against duplicate submission while a request is in
  flight, and MUST surface a clear pending/disabled state.

### Key Entities *(include if feature involves data)*

- **User**: A registered account. Attributes used by this feature: a stable internal
  id, a display name, a unique email (the login identifier), and a securely hashed
  password (never exposed). Public representation is limited to id, name, email, and
  created/updated timestamps.
- **Session / credential**: The authenticated state established at login or
  registration and revoked at logout, by which the current-user and any future
  protected endpoints recognize the user. Treated as opaque by the UI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new visitor can complete registration and reach a logged-in state in
  under 1 minute, in 100% of valid-input attempts.
- **SC-002**: 100% of invalid registration submissions (duplicate email, weak
  password, mismatched confirmation) are rejected with a clear field-level message and
  create no account.
- **SC-003**: 100% of login attempts with correct credentials authenticate, and 100%
  with incorrect credentials are rejected with a single non-disclosing error.
- **SC-004**: Logging out revokes the session in 100% of cases, after which protected
  views/endpoints are inaccessible until the user logs in again.
- **SC-005**: 100% of the redirect rules hold when auth URLs are opened directly:
  anonymous `/account` → `/login`; authenticated `/login` or `/register` → home feed.
- **SC-006**: Refreshing any authenticated view restores the logged-in UI from the
  existing session without a forced re-login, in 100% of tested cases with a valid
  session.
- **SC-007**: All three auth views render with no horizontal scrolling, clipping, or
  overlap at representative mobile, tablet, and desktop widths, and follow the system
  light/dark preference on first load.
- **SC-008**: Every auth form input has an associated label and every validation error
  is programmatically associated and conveyed by text (not color alone), verified
  across all three pages.
- **SC-009**: No response anywhere in the feature exposes a password hash or other
  sensitive user field; only id, name, email, and timestamps appear.
- **SC-010**: Backend and frontend code added by this feature keeps total line
  coverage at or above 90% (constitutional test gate), covering happy paths and the
  documented edge cases.

## Assumptions

- Authentication uses the existing stack baseline — Laravel + **Sanctum** on the
  backend and React + React Router on the frontend — with no new runtime dependency
  introduced without separate approval per the constitution's Minimal Dependencies
  principle. The exact Sanctum mode (SPA cookie session vs. token credential) is a
  plan-time decision; the prototype used a token delivered in a cookie and is the
  informal reference.
- The `User` model already present in `backend/app/Models` is the account store;
  schema additions, if any, go through Laravel migrations. No change to the existing
  feed API is assumed.
- The prototype's `AuthController`, `RegisterRequest`/`LoginRequest`, and
  `UserResource`, and its `LoginPage`/`RegisterPage`/`AccountPage`, are the parity
  reference for fields, validation rules, and flows; where they predate or conflict
  with the constitution or `docs/CODING_CONVENTIONS.md`, those win.
- Password strength policy mirrors the prototype's baseline (minimum 8 characters with
  mixed case and a number); the "not previously compromised" check is treated as
  optional/plan-time because it depends on an external service and the Minimal
  Dependencies principle.
- The site layout, theming (`prefers-color-scheme`), and responsive behavior built in
  features 005/006 are reused for the auth pages.
- The feature is for end users registering with name/email/password; administrative
  user management, roles, and permissions are out of scope.

## Out of Scope

- Password reset / forgot-password flow and email verification (the prototype's
  `PwdResetPage` and mail are deferred to a later feature).
- Editing the account profile (changing name, email, or password) and account
  deletion.
- Social / OAuth / SSO login.
- Roles, permissions, and any admin user-management UI.
- Uploading, commenting, voting, or any logged-in feature beyond viewing the account
  and logging out — those are separate features that will build on this one.
- "Remember me" / long-lived persistent sessions beyond the project's default session
  lifetime.

## Dependencies

- **Existing `User` model and Sanctum baseline** in `backend/` (the auth credential
  mechanism this feature configures and consumes).
- **Feature 005 (frontend mainpage)** and **Feature 006 (post page)**: the site
  layout (header, navigation menu), theming, and routing conventions the auth pages
  plug into.
- **Prototype** `C:\projects\trash` auth surface (controller, requests, resource, and
  React auth pages) as the parity reference.
