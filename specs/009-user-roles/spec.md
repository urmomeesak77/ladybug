# Feature Specification: User Roles (Backbone)

**Feature Branch**: `009-user-roles`

**Created**: 2026-07-08

**Status**: Draft

**Input**: User description: "lets introduce user roles. guest (not logged user), user (standard logged in user, maybe you can come up with better name for that), admin, superuser. 1 role per user. guest can watch the memes. user can upload memes, their account info etc. admin can hide/delete/verify memes, lower users etc. superuser can do anything. the actions available for them is out of scope of this plan. lets just make backbone of it"

## Overview

This feature introduces the **role backbone**: a single role attached to every account,
a fixed, ordered set of roles, and the ability for any part of the system (now or later)
to ask "what role does this actor have?" and "does actor A outrank actor B?".

It deliberately does **not** implement any of the privileged actions those roles will
eventually gate (uploading, hiding, deleting, verifying memes, changing other users'
roles, etc.). Those are named here only to establish the *ordering* between roles; their
behaviour is out of scope. What ships is the data, the vocabulary, and the plumbing that
future features will hang permissions off of.

### Role vocabulary

Four roles form a strict hierarchy from least to most privileged:

| Rank | Role | Stored on account? | Meaning |
|------|------|--------------------|---------|
| 0 | **guest** | No — implicit | An unauthenticated visitor (no account / no session). Can browse and watch memes only. |
| 1 | **member** | Yes | A standard logged-in user (the "user" role from the description, renamed to avoid colliding with the "user account" concept). Owns their account and content. |
| 2 | **admin** | Yes | A moderator who can act on memes and on accounts ranked strictly below them. |
| 3 | **superuser** | Yes | Unrestricted; outranks everyone. |

**Naming note**: the standard logged-in role is called **member** rather than "user"
(confirmed in Clarifications 2026-07-08). Every account is already a "user" in the system,
so a role *also* named "user" is ambiguous; "member" reads clearly in both code and UI.
This is the canonical term used everywhere in this spec (enum value, UI label, test
vocabulary).

## Clarifications

### Session 2026-07-08

- Q: Canonical name for the standard logged-in role? → A: **member** (confirmed; not "user", to avoid colliding with the user-account concept)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every account carries exactly one role (Priority: P1)

Every account in the system has one, and only one, role at all times. A newly registered
account is a **member** by default. The role travels with the account and can be read back
wherever the account is known.

**Why this priority**: This is the foundation. Without a role reliably present on every
account, nothing downstream (menus, guards, moderation) can make a decision. It is the
minimum viable slice — with just this, the product has a working role model even before any
role-gated action exists.

**Independent Test**: Register a new account and confirm it comes back with the role
**member**. Inspect any existing account and confirm it has exactly one role from the
allowed set. Confirm no account can exist with zero roles or more than one role.

**Acceptance Scenarios**:

1. **Given** a visitor completes registration, **When** the account is created, **Then** it
   has the single role **member**.
2. **Given** any existing account, **When** its role is inspected, **Then** exactly one role
   value is present and it is one of {member, admin, superuser}.
3. **Given** an account, **When** an attempt is made to give it a role outside the allowed
   set, **Then** the attempt is rejected and the account keeps a valid role.

---

### User Story 2 - The current viewer's role is knowable (Priority: P1)

Any consumer of the system — the frontend UI, an access guard, a future moderation screen —
can determine the role of the current actor: **guest** when nobody is logged in, or the
account's stored role (member / admin / superuser) when someone is.

**Why this priority**: A role that cannot be observed is useless. The UI must be able to
decide, for example, whether to show an "Upload" or "Moderate" entry, and guards must be
able to allow or deny. This makes the role actionable without yet defining any specific
action.

**Independent Test**: As an unauthenticated visitor, ask "what is my role?" and get
**guest**. Log in as each stored role and confirm the reported role matches the account.

**Acceptance Scenarios**:

1. **Given** no active session, **When** the current role is requested, **Then** the answer
   is **guest**.
2. **Given** a logged-in account with role admin, **When** the current role is requested,
   **Then** the answer is **admin**.
3. **Given** a logged-in account, **When** the account's public representation is retrieved,
   **Then** it includes the account's role.

---

### User Story 3 - Roles are ordered so "outranks" can be answered (Priority: P2)

The system can answer whether one actor outranks another using the fixed order
guest < member < admin < superuser. This is the single primitive on which all future
"admin can act on lower users", "superuser can do anything" rules will be built.

**Why this priority**: The description repeatedly frames privileges relative to rank
("lower users", "superuser can do anything"). Encoding the ordering now — even with no
action attached — means later features add only the action, not the ranking logic. It is
P2 because Stories 1–2 already deliver a usable role model; this makes it *comparable*.

**Independent Test**: Given two roles, ask which outranks the other and confirm the answer
follows guest < member < admin < superuser. Confirm equal roles do not outrank each other.

**Acceptance Scenarios**:

1. **Given** an admin and a member, **When** ranks are compared, **Then** the admin outranks
   the member.
2. **Given** two admins, **When** ranks are compared, **Then** neither outranks the other.
3. **Given** a superuser and any other role, **When** ranks are compared, **Then** the
   superuser outranks it.
4. **Given** any authenticated role and a guest, **When** ranks are compared, **Then** the
   authenticated role outranks the guest.

---

### User Story 4 - A first superuser can be established (Priority: P2)

There is a supported way to designate the initial **superuser** without an existing
privileged account, so the hierarchy can be bootstrapped. (Promoting/demoting other
accounts through the UI is a role-gated *action* and is out of scope; only the ability to
seed the very first superuser is in scope here.)

**Why this priority**: A hierarchy with no way to create its top account is inert. The
first superuser must be establishable by an operator (e.g. via a controlled backend
mechanism), because no in-app actor is yet allowed to grant roles.

**Independent Test**: Starting from a system with only default members, use the supported
bootstrap mechanism to make a specific account a superuser, then confirm that account
reports role **superuser**.

**Acceptance Scenarios**:

1. **Given** a system with no superuser, **When** an operator applies the supported bootstrap
   mechanism to a chosen account, **Then** that account becomes a **superuser**.
2. **Given** the bootstrap mechanism, **When** it is used, **Then** it is not reachable as an
   ordinary in-app request by non-privileged users.

---

### Edge Cases

- **Accounts created before this feature**: existing accounts must receive a valid role on
  rollout. They are backfilled to **member** (the safe, least-privileged authenticated role).
- **Guest is not a stored value**: "guest" describes the absence of authentication, not a row
  in the set of assignable account roles. It can never be assigned to an account.
- **Unknown / missing role on an account**: must be impossible — the role is required and
  constrained to the allowed set; a missing or invalid role is treated as a data error, not
  silently downgraded at read time.
- **Equal ranks**: two accounts of the same role do not outrank each other (relevant later
  for "admin acting on admin"); the ordering is strict.
- **Superuser vs superuser**: superusers are equal in rank; nothing outranks a superuser.
- **Role of a logged-in but unverified account**: role assignment is independent of email
  verification — an unverified member is still a member (verification gating remains the
  concern of feature 008, not this one).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define exactly four roles — **guest**, **member**, **admin**,
  **superuser** — as a fixed, closed set.
- **FR-002**: The system MUST treat the roles as a strict total order:
  guest < member < admin < superuser.
- **FR-003**: Every account MUST have exactly one role at all times, drawn from
  {member, admin, superuser} (guest is never stored on an account).
- **FR-004**: A newly registered account MUST default to the **member** role.
- **FR-005**: The system MUST reject any attempt to set an account's role to a value outside
  {member, admin, superuser}.
- **FR-006**: The system MUST report the current actor's effective role as **guest** when
  there is no authenticated session (derived by the client from a null user — the backend returns
  `{data: null}` and never emits a `guest` role).
- **FR-007**: The account's role MUST be included in the account's representation exposed to
  the authenticated frontend (so the UI can adapt to it).
- **FR-008**: The system MUST provide a way to determine whether one role outranks another,
  consistent with the ordering in FR-002, including that equal roles do not outrank each
  other.
- **FR-009**: The system MUST provide a supported mechanism to establish the initial
  **superuser** account that does not depend on a pre-existing privileged account, and that
  is not exposed as an ordinary in-app action to non-privileged users.
- **FR-010**: On rollout, the system MUST assign a valid role to every pre-existing account,
  defaulting them to **member**.
- **FR-011**: Role assignment MUST be independent of email verification status and of any
  content the account owns.
- **FR-012**: The set of roles and their ordering MUST be defined in one authoritative place
  so that UI, access checks, and data validation all agree on the same vocabulary.

**Explicitly out of scope (named only to fix the ordering, not implemented here):**

- **OOS-001**: Enforcing what each role may *do* — uploading, editing account info, hiding /
  deleting / verifying memes, moderating or re-ranking other users. These privileged actions
  are deferred to their own features.
- **OOS-002**: Any UI for changing another account's role (promotion/demotion flows) beyond
  the initial-superuser bootstrap.
- **OOS-003**: Multiple roles per account, per-resource permissions, or group/team concepts.
  One role per account only.

### Key Entities *(include if feature involves data)*

- **Role**: A named, ranked level of privilege from the fixed set {guest, member, admin,
  superuser}. Guest is the implicit level for unauthenticated actors; the other three are the
  values assignable to an account. Roles carry a strict order (guest lowest, superuser
  highest) used to decide "outranks".
- **Account (User)**: The existing user account entity, now carrying exactly one assignable
  **Role** (default **member**). Its role is part of how the account is represented to the
  authenticated client. All other account attributes are unchanged by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of accounts (newly registered and pre-existing after rollout) have exactly
  one valid role from the allowed set — zero accounts with no role or an out-of-set role.
- **SC-002**: 100% of newly registered accounts have the **member** role immediately after
  registration.
- **SC-003**: For an unauthenticated visitor, the system reports the effective role **guest**
  in 100% of checks; for an authenticated account it reports the account's stored role in
  100% of checks.
- **SC-004**: For every ordered pair of roles, the "outranks" answer matches
  guest < member < admin < superuser (and equal-rank pairs return "does not outrank") — 100%
  agreement across all 16 role pairs.
- **SC-005**: A single **superuser** account can be established from a clean system with no
  prior privileged account using the supported bootstrap mechanism.
- **SC-006**: The role and its ordering are defined in exactly one authoritative location **per
  stack** (backend enum + frontend mirror) that UI, access checks, and validation all reference —
  no duplicated, divergent role lists within a stack, and the two mirrors are pinned to the same
  ordering by an identical 16-pair matrix test (SC-004).

## Assumptions

- **The standard logged-in role is named "member"** (renamed from the description's "user",
  confirmed in Clarifications 2026-07-08) to avoid ambiguity with the user-account concept.
- **Guest is implicit, not stored**: it represents "no authenticated account". Only member /
  admin / superuser are assignable values persisted on an account.
- **One role per account** is a hard rule (explicit in the description: "1 role per user");
  no multi-role or per-resource permission model is introduced.
- **Default role is member**: the least-privileged authenticated role, applied to new
  registrations and to backfilled pre-existing accounts.
- **The existing account/auth system (feature 007) is reused**; the current viewer's identity
  and session come from it, and role is exposed through the same authenticated
  account representation.
- **Privileged actions are deferred**: the moderation/upload/account capabilities the roles
  will eventually gate are out of scope; only the role model, its ordering, and its exposure
  are built now.
- **The initial-superuser bootstrap** is an operator-level mechanism (e.g. a controlled
  backend step), not an in-app user flow, since no privileged account exists to authorize it.
