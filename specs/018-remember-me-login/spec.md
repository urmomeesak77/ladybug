# Feature Specification: "Remember Me" Login Session Persistence

**Feature Branch**: `018-remember-me-login`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "add \"Remember me\" functionality to login page. Users session stays active for 7 days after last seen"

## Clarifications

### Session 2026-08-05

- Q: Does "Remember me" apply uniformly across all account roles (member, admin, superuser), or are privileged accounts exempted from the extended session? → A: Applies uniformly to all roles — one policy, no role-based exception.
- Q: What's the target percentage for SC-001 (auto-signed-in on return within 7 days) and SC-002 (prompted to log in after 7+ days idle)? → A: 99%.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stay signed in with Remember Me (Priority: P1)

A returning user logs in, checks "Remember me", and closes the browser. When they come back on a later day, they are still signed in and go straight to the feed instead of seeing the login page.

**Why this priority**: This is the entire point of the feature — without it, "Remember me" does nothing and the feature has no value.

**Independent Test**: Log in with "Remember me" checked, simulate returning after a few days (but under 7) of inactivity, and confirm the user is still signed in with no re-authentication required.

**Acceptance Scenarios**:

1. **Given** a user is on the login page, **When** they check "Remember me" and log in successfully, **Then** they remain signed in across browser restarts.
2. **Given** a user logged in with "Remember me" checked, **When** they return 3 days after their last activity, **Then** they are still signed in.

---

### User Story 2 - Remembered session eventually expires from inactivity (Priority: P2)

A user who checked "Remember me" stops visiting the site. After 7 full days with no activity, their session ends, and their next visit takes them to the login page.

**Why this priority**: Bounds how long a session can be reused if a device is lost, shared, or abandoned — without this, "Remember me" would mean "signed in forever," which is a security concern.

**Independent Test**: Log in with "Remember me" checked, simulate exactly 7 days of no activity, and confirm the next visit requires signing in again.

**Acceptance Scenarios**:

1. **Given** a user logged in with "Remember me" checked, **When** 7 days pass with no activity on that session, **Then** their next visit shows the login page.
2. **Given** a user logged in with "Remember me" checked, **When** they return and use the site on day 5, **Then** the 7-day countdown restarts from that visit (their session survives past what would have been the original 7-day mark).

---

### User Story 3 - Default (non-remembered) sign-in is unaffected (Priority: P3)

A user logs in without checking "Remember me". Their session behaves exactly as it does today — no extended persistence.

**Why this priority**: Protects users on shared or public computers, who should not be signed in indefinitely by default, and confirms the new feature is purely additive/opt-in.

**Independent Test**: Log in without checking "Remember me" and confirm the sign-in duration matches current (pre-feature) behavior.

**Acceptance Scenarios**:

1. **Given** a user is on the login page, **When** they log in without checking "Remember me", **Then** their session follows the product's existing (shorter) sign-in duration, unchanged by this feature.

---

### Edge Cases

- Manually signing out ends the session immediately, whether or not "Remember me" was checked — the 7-day allowance never overrides an explicit sign-out.
- If an account is disabled or deleted while a remembered session exists, the next request on that session is rejected, same as it is today for any active session.
- Checking "Remember me" on one device/browser has no effect on the user's other active sessions elsewhere — each sign-in's persistence is independent.
- "Remember me" is a one-time choice made at login (the checkbox itself is not pre-filled from a prior visit); it is not a standing account-wide preference.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The login page MUST present a "Remember me" checkbox, unchecked by default.
- **FR-002**: When a user logs in with "Remember me" checked, the system MUST keep that session active for up to 7 days measured from the user's most recent activity on it (a sliding expiration), rather than expiring on the product's normal shorter schedule. This applies uniformly regardless of the account's role (member, admin, or superuser) — there is no role-based exception.
- **FR-003**: When a user logs in without checking "Remember me", the system MUST apply the product's existing sign-in duration, unaffected by this feature.
- **FR-004**: The system MUST treat any authenticated request on a remembered session as activity that resets its remaining 7-day allowance.
- **FR-005**: Users MUST be able to sign out at any time, which immediately ends the session regardless of whether "Remember me" was selected.
- **FR-006**: The system MUST reject requests from a remembered session belonging to a disabled or deleted account, consistent with how active sessions for such accounts are already handled today.
- **FR-007**: The "Remember me" choice MUST apply only to the session created by that specific login and MUST NOT extend or otherwise change any of the user's other active sessions.

### Key Entities

- **Session**: A user's signed-in state on one device/browser. It carries an expiration that is either the product's normal duration, or — when the user chose "Remember me" at login — a sliding 7-day-since-last-activity duration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who checked "Remember me" and returns within 7 days of their last activity is signed in automatically, with no login prompt, on at least 99% of such visits.
- **SC-002**: A user who checked "Remember me" but does not return within 7 days of their last activity is shown the login page on at least 99% of first visits after the 7-day mark.
- **SC-003**: A user who did not check "Remember me" sees no change in sign-in duration compared to today's behavior.
- **SC-004**: Manual sign-out ends the session immediately in 100% of cases, regardless of the "Remember me" choice.

## Assumptions

- "Remember me" is an opt-in choice made at each login (checkbox unchecked by default); it is not saved as a standing preference that pre-fills on future visits.
- The 7-day period is a sliding window measured from the session's last authenticated activity, not a fixed 7-day expiry timestamped from the moment of login.
- Not checking "Remember me" leaves today's sign-in duration exactly as it is now — this feature only adds the extended, opt-in path.
- "Remember me" persistence is per browser/device session; it never signs the user in anywhere else.
- Invalidating remembered sessions on password change is out of scope, since password reset/change is not yet built in this product.
