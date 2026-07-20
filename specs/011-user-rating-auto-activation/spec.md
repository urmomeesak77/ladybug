# Feature Specification: User Rating & Auto-Activation

**Feature Branch**: `011-user-rating-auto-activation`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "lets add new field to users table: rating, smallint. Everytime users upload gets activated its increased by 1, every time his post is deleted (both soft and hard), its decreased by 1. When user uploads some new content and his rating is 15 or more, it gets activated automatically. If its less admins have to activate it first. If admins upload somethin, it get activated right away"

## Overview

Today every uploaded meme waits for an admin to activate it before the public can see it
(feature 010 supplies the moderation table and the Activate/Deactivate/Delete/Restore
actions). That gate is correct for a newcomer and pure friction for a proven contributor.

This feature introduces a **rating**: a per-account integer that tracks whether an account's
contributions have historically been kept or thrown away. Ratings rise when an account's memes
get activated and fall when they get deleted. Once an account's rating reaches a trust
threshold, its uploads skip the moderation queue and go live immediately. Admins and
superusers always skip it, regardless of rating.

The result is that moderator attention concentrates on unproven and untrustworthy accounts,
while established contributors publish without waiting.

## Clarifications

### Session 2026-07-20

- Q: If a meme is soft-deleted and later hard-deleted, is the owner penalised once or twice? → A: **Once.** A given meme costs its owner at most −1 for deletion, no matter how many delete operations touch it.
- Q: May a rating fall below zero? → A: **Yes.** Ratings are signed and may go negative; there is no floor at zero.
- Q: Does deactivating an activated meme reverse the +1 its activation earned? → A: **Yes.** Activation credit is held only while the meme is actually activated; deactivating gives the point back.
- Q: What happens at the extremes of the stored numeric range? → A: **Saturate.** At the maximum a further increase is a no-op, at the minimum a further decrease is a no-op, and the moderation action that triggered it still succeeds.
- Q: May a moderator adjust an account's rating by hand? → A: **Not in this feature.** No actor, including admins and superusers, can set a rating directly; it moves only via the defined activation and deletion events. A moderator override is recorded as a deferred follow-up.
- Q: Where do moderators actually see a rating, given there is no account-review surface? → A: **On the meme moderation table.** Each row shows its uploader's current rating; a dedicated admin accounts list is out of scope and deferred to a future feature.
- Q: Existing accounts start at 0, but they already own activated memes — should the launch baseline be back-computed so the rating invariant holds? → A: **No.** Every existing account starts at 0 and the rating model governs only events occurring after launch; pre-existing memes carry no credit, so deactivating one costs its owner an unearned −1.

### Rating model

The clarifications above resolve to a single state-based rule that every requirement below
restates in operational terms:

> **rating = (memes currently activated and not deleted) − (memes deleted, soft or purged)**

A meme is worth **+1** to its owner while it is live and activated, **−1** once it is deleted
by any means, and **0** otherwise. This holds regardless of the order operations are applied
in — activate-then-purge, activate-then-soft-delete-then-purge, and
activate-then-deactivate-then-purge all leave the owner at −1 for that meme.

**Scope of the model.** The rule governs moderation events that occur **after this feature is
introduced**. Every account — new or existing — starts from a rating of 0 (FR-002), so memes
already activated at launch carry no credit into that baseline. A legacy meme therefore behaves
as though its activation happened before the ledger opened: deactivating or deleting it applies
the normal −1 even though no matching +1 was ever granted. Ratings converge on the model's
value through ordinary moderation activity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An account carries a rating that reflects its record (Priority: P1)

Every account has a rating. It starts at zero for a newly registered account and moves as the
account's memes are activated or deleted by moderators. The rating is a single number that can
be read for any account and is durable across sessions.

**Why this priority**: The rating is the substrate the whole feature stands on. Until it
exists and moves correctly, neither the auto-activation rule nor any future trust-based
behaviour can be built. It delivers standalone value immediately: moderators gain a
one-number summary of whether an account's past contributions were kept or binned.

**Independent Test**: Register an account, confirm its rating is zero, then have a moderator
activate and delete some of its memes and confirm the rating tracks each event correctly. No
upload or auto-activation behaviour is needed to test this.

**Acceptance Scenarios**:

1. **Given** a newly registered account, **When** its rating is read, **Then** it is zero.
2. **Given** an account owns a meme that has never been activated, **When** a moderator
   activates that meme, **Then** the account's rating increases by exactly 1.
3. **Given** an account owns a meme, **When** a moderator soft-deletes it, **Then** the
   account's rating decreases by exactly 1.
4. **Given** an account owns a meme, **When** a moderator hard-deletes (purges) it, **Then**
   the account's rating decreases by exactly 1.
5. **Given** an account owns an activated meme, **When** a moderator deactivates it, **Then**
   the account's rating decreases by exactly 1, reversing the activation credit.
6. **Given** a meme that has already been soft-deleted (costing its owner −1), **When** a
   moderator then hard-deletes that same meme, **Then** no second deletion penalty is applied
   — the meme has already been counted as deleted.
7. **Given** an account with rating 0, **When** one of its memes is deleted, **Then** the
   rating becomes −1.
8. **Given** a meme with no owning account, **When** it is activated or deleted, **Then** no
   rating is adjusted and the operation still succeeds.
9. **Given** an activated, never-deleted meme, **When** it is hard-deleted outright, **Then**
   its owner's rating falls by exactly 2 — the activation credit is released and the deletion
   penalty applied — leaving the same net −1 for that meme as any other route to deletion.

---

### User Story 2 - Trusted contributors publish without waiting (Priority: P1)

A member whose rating has reached the trust threshold uploads a meme and it is live
immediately — no moderator step, no queue. A member below the threshold uploads and the meme
waits, unactivated, until a moderator activates it.

**Why this priority**: This is the payoff the rating exists to deliver. It is what the
uploader actually experiences and what removes load from moderators.

**Independent Test**: Set one account's rating at or above the threshold and another below it,
have each upload a meme, and confirm the first meme is publicly visible right away while the
second is not until a moderator acts.

**Acceptance Scenarios**:

1. **Given** a member whose rating is at or above the trust threshold, **When** they upload a
   meme, **Then** the meme is activated immediately and appears in the public feed without
   moderator action.
2. **Given** a member whose rating is below the trust threshold, **When** they upload a meme,
   **Then** the meme is created unactivated and does not appear in the public feed.
3. **Given** a meme awaiting activation from a below-threshold member, **When** a moderator
   activates it, **Then** it appears in the public feed and its owner's rating increases by 1.
4. **Given** a member sitting exactly one point below the threshold, **When** one of their
   pending memes is activated (taking them to the threshold) and they then upload again,
   **Then** the new upload is activated automatically.
5. **Given** an auto-activated upload, **When** the upload completes, **Then** the uploader's
   rating increases by 1 — an auto-activation counts the same as a moderator activation.

---

### User Story 3 - Moderators publish immediately regardless of rating (Priority: P2)

An admin or superuser uploads a meme and it goes live immediately, whatever their rating —
including a negative one. Their own uploads never enter the moderation queue.

**Why this priority**: A moderator queuing content for themselves to approve is pure
ceremony. It matters, but the site functions correctly without it, so it ranks below the two
P1 stories.

**Independent Test**: Give an admin account a rating well below the threshold, have them
upload, and confirm the meme is live immediately.

**Acceptance Scenarios**:

1. **Given** an admin whose rating is below the trust threshold, **When** they upload a meme,
   **Then** it is activated immediately.
2. **Given** a superuser whose rating is negative, **When** they upload a meme, **Then** it is
   activated immediately.
3. **Given** an admin's auto-activated upload, **When** the upload completes, **Then** the
   admin's rating increases by 1, consistent with every other activation.

---

### Edge Cases

- **Deletion of a never-activated meme**: the owner is penalised −1 even though they never
  earned the matching +1. A rejected upload is a net loss — this is the intended deterrent
  against low-effort spam.
- **Restore after soft delete**: restoring a soft-deleted meme returns the −1 it cost, so a
  takedown an admin reverses leaves no lasting penalty.
- **Deactivation**: deactivating an activated meme reverses its +1. A meme earns its owner a
  point only while it is actually live and activated.
- **Activation churn**: a meme cycled activate → deactivate → activate leaves its owner at
  +1, not +2. Repeatedly toggling must not let an account farm rating.
- **Hard delete of a live activated meme**: two adjustments land at once — the activation
  credit is released and the deletion penalty applied, for −2 in that single operation. The
  meme's lifetime total is still −1, matching every other route to deletion.
- **A meme deleted while already deactivated**: only the deletion penalty applies (−1); there
  is no credit left to release.
- **Memes activated before this feature existed**: they hold no rating credit, because every
  account's baseline is 0 (FR-002). Deactivating or deleting one still applies the normal −1,
  so an established account can be pushed negative by moderation of its older content. This is
  accepted: ratings are a forward-looking signal and converge through ordinary activity.
- **Memes with no owning account**: legacy rows carry an uploader name but no linked account.
  Activation and deletion of these must succeed with no rating side effect.
- **Rating floor and ceiling**: ratings may be negative, and may rise, freely within the stored
  numeric range. At either extreme the rating saturates (FR-011a): the further adjustment is
  silently dropped, the value never wraps or corrupts, and the moderation action that triggered
  it still succeeds.
- **Concurrent moderation**: two moderators acting on the same meme at the same moment must
  not double-count a single activation or deletion.
- **A moderation action that fails partway**: the meme's state and its owner's rating must
  never disagree — either both change or neither does.
- **Role change**: an account promoted to admin gains immediate-publish rights from that point
  on; it does not retroactively alter ratings or already-pending memes.

## Requirements *(mandatory)*

### Functional Requirements

#### Rating storage

- **FR-001**: Every account MUST carry a rating: a whole number, signed, defaulting to 0 for
  newly created accounts.
- **FR-002**: Existing accounts MUST receive a rating when this feature is introduced. Their
  starting value MUST be 0 rather than a value back-computed from historical activity —
  including from memes that are already activated at that moment. Consequently the rating
  adjustments below MUST apply only to moderation events occurring after introduction, and a
  meme activated before introduction holds no credit that a later deactivation could release.
- **FR-003**: An account's rating MUST NOT be settable directly by any request, from any actor
  or role — not the account's own owner, and not an admin or superuser. It changes only as a
  consequence of the activation and deletion events defined below. This feature MUST expose no
  path, moderator-facing or otherwise, that writes a rating to a chosen value.

#### Rating adjustments

- **FR-004**: A meme MUST contribute **+1** to its owning account's rating for exactly as long
  as it is activated and not deleted, and MUST contribute nothing otherwise.
- **FR-005**: When a meme is activated, its owning account's rating MUST increase by exactly
  1. When a meme is deactivated, that account's rating MUST decrease by exactly 1, releasing
  the credit.
- **FR-006**: Activation and deactivation MUST be repeatable without drift: any number of
  activate/deactivate cycles on one meme MUST leave its owner's rating exactly where the
  meme's final state dictates, never accumulating stray points in either direction.
- **FR-007**: When a meme is deleted — soft or hard — its owning account's rating MUST
  decrease by exactly 1.
- **FR-008**: A meme MUST cost its owner at most one deletion penalty. A meme that is
  soft-deleted and subsequently hard-deleted MUST apply a total of one deletion penalty, not
  two.
- **FR-009**: Hard-deleting a meme MUST also release any activation credit it is currently
  holding, so that every route to deletion leaves the owner at a net −1 for that meme
  regardless of the order of operations.
- **FR-010**: Restoring a soft-deleted meme MUST return the deletion penalty, raising its
  owner's rating by 1, and MUST leave that meme eligible to be penalised again if it is
  deleted once more.
- **FR-011**: Ratings MUST be permitted to go below zero. There is no floor within the stored
  numeric range.
- **FR-011a**: A rating MUST saturate at the bounds of its stored range: an increase applied at
  the maximum, or a decrease applied at the minimum, MUST leave the rating unchanged rather than
  wrapping or erroring. The moderation action that triggered the adjustment MUST still succeed.
- **FR-012**: Activating, deactivating, or deleting a meme that has no owning account MUST
  complete successfully and adjust no rating.
- **FR-013**: A rating adjustment and the moderation action that caused it MUST take effect
  together or not at all; a failure in either MUST leave both unchanged.
- **FR-014**: Concurrent or repeated moderation actions on the same meme MUST NOT apply the
  same adjustment more than once.

#### Auto-activation on upload

- **FR-015**: When an account uploads a meme, the system MUST decide immediately whether the
  meme is activated on creation or left pending moderator activation.
- **FR-016**: An upload MUST be activated on creation when the uploader's rating is at or
  above the trust threshold of **15**.
- **FR-017**: An upload MUST be activated on creation when the uploader holds the admin or
  superuser role, regardless of that account's rating.
- **FR-018**: An upload from an account that meets neither condition MUST be created
  unactivated and MUST NOT appear in any public view until a moderator activates it.
- **FR-019**: An upload activated on creation MUST increase the uploader's rating by 1, on the
  same terms as a moderator-driven activation (FR-005).
- **FR-020**: The threshold comparison MUST use the uploader's rating as it stands at the
  moment of upload, before the new upload's own activation credit is applied.

#### Visibility of the rating

- **FR-021**: The meme moderation table MUST show, for each meme it lists, the current rating
  of that meme's owning account, so a moderator can see why an upload did or did not
  auto-activate. Memes with no owning account MUST render an explicit "no account" indication
  rather than a numeric rating or a blank cell.
- **FR-022**: An account's rating MUST NOT be exposed to other end users as part of public
  meme or feed data.

### Key Entities *(include if feature involves data)*

- **Account**: gains a **rating** attribute — a signed whole number, default 0, adjusted only
  by the system in response to meme activation and deletion. Read by the upload path to decide
  auto-activation. Related to the account's existing **role**, which independently grants
  immediate publication to admins and superusers.
- **Meme**: gains the notion of whether it is **currently crediting** its owner (held while
  activated and not deleted) and whether it has **already been penalised** for deletion (so a
  soft-then-hard delete counts once). This is bookkeeping about what the meme has already
  contributed to its owner's rating, distinct from its activated and deleted states
  themselves — and it must survive the meme being hard-deleted, since the row is gone but the
  rating effect is permanent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contributor whose rating has reached 15 sees their upload publicly visible
  immediately on completing the upload, with zero moderator involvement.
- **SC-002**: 100% of uploads from accounts below the threshold that do not hold a moderator
  role remain invisible to the public until a moderator activates them.
- **SC-003**: For memes whose moderation events all occur after this feature is introduced, an
  account's rating equals (number of its memes currently activated and not deleted) minus
  (number of its memes that have been deleted, soft or purged), for every sequence of activate,
  deactivate, delete, restore, and purge operations. Memes activated before introduction are
  outside this measure, since no account carries a back-computed starting value (FR-002).
- **SC-004**: Any two sequences of moderation operations that leave a meme in the same final
  state leave its owner's rating identical — the rating depends on where the memes ended up,
  never on the route taken.
- **SC-005**: No amount of repeated or simultaneous moderation activity on a single meme can
  move its owner's rating outside the range −1 to +1 attributable to that meme. For a meme
  already activated before this feature was introduced the attributable range is −2 to 0, since
  it carries no credit into the baseline but is still subject to the full deactivation and
  deletion adjustments.
- **SC-006**: The share of uploads requiring manual moderator activation falls measurably once
  established contributors cross the threshold, concentrating moderator time on new and
  low-rated accounts.
- **SC-007**: A moderator reviewing the meme moderation table can read each meme's owner rating
  from the row itself and correctly predict whether that account's next upload will
  auto-activate, without leaving the table or consulting another view.

## Assumptions

- **Trust threshold is 15** and is a fixed system-wide value, as stated in the feature
  description. It is not per-account or configurable by end users.
- **Restore returns the penalty** (FR-010). The feature description covered deletion but not
  restoration; returning the point is the consistent counterpart to the "at most one penalty
  per meme" rule confirmed in Clarifications, and it avoids permanently penalising an account
  for a takedown a moderator subsequently reverses.
- **Hard delete releases the activation credit** (FR-009). Confirmed as the consequence of
  deactivation reversing the +1 (Clarifications 2026-07-20): if credit is held only while a
  meme is activated, a purged meme cannot keep holding it. This is what makes the rating
  path-independent (SC-004); without it, whether a moderator deactivated before purging would
  silently change the uploader's final score.
- **Admin uploads still earn rating** (FR-019, US3 scenario 3). Activation is activation; no
  exception is made for moderators, keeping the rule uniform and the rating meaningful if the
  account is later demoted.
- **Ratings start at zero for existing accounts** (FR-002) rather than being back-filled from
  historical activation and deletion records — confirmed in Clarifications 2026-07-20.
  Back-filling would require rating-history bookkeeping that does not exist on current data, and
  every existing account converges to a correct rating through normal moderation activity. The
  accepted cost is that moderating pre-existing content applies penalties without matching
  credit, which SC-003 and SC-005 scope explicitly.
- **Guests cannot upload**, so no rating logic is needed for unauthenticated uploads. Uploading
  requires at least the member role, per the role backbone.
- **The meme moderation table is the only rating surface in this feature** (FR-021). A dedicated
  admin accounts list — browsing accounts by username, role, and rating — is explicitly out of
  scope and deferred to a future feature; nothing here depends on it existing.
- **No manual rating override in this feature** (FR-003). A moderator-driven adjustment path is
  deferred alongside the accounts list, and would need its own authorization and audit-trail
  requirements. Until it exists, the cold-start cost of the zero baseline (FR-002) is absorbed
  by convergence through normal moderation, with no lever to shortcut it.
- **Rating is a moderator-facing signal only** (FR-022). It is not shown to the public, not
  displayed as a badge, and not used for feed ranking. Any such use is a separate feature.

## Dependencies

- **Feature 008 (upload) supplies the creation path.** This bullet originally stated that no
  upload path existed and that FR-015 through FR-020 defined a contract for a future feature.
  That was true when this spec was drafted against the feature list but is **stale**: feature
  008 shipped `POST /api/posts`, `TrashpostService::createPost()`, and the upload UI (verified
  against source, research D0). All of FR-001 through FR-022 are therefore implementable and
  testable now, as one deliverable rather than a split one. Note that `createPost()` today
  activates *every* upload unconditionally — FR-018 is a behaviour change to shipped code, not
  new construction.
- **Feature 010 (admin meme moderation)** supplies the activate, deactivate, delete, restore,
  and purge operations that this feature hangs rating adjustments off. Those operations are
  already idempotent, which FR-014 relies on. Note that FR-005 and FR-009 give deactivate and
  purge rating consequences they do not have today, so both operations gain behaviour here.
- **Feature 009 (user roles)** supplies the role hierarchy that FR-017 reads to grant admins
  and superusers immediate publication.
