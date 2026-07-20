# Specification Quality Checklist: User Rating & Auto-Activation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Three clarifications were answered by the user on 2026-07-20 and are recorded in the spec's
  Clarifications section: deletion penalises a meme's owner at most once (soft-then-hard
  counts as one), ratings may go negative, and deactivation reverses the activation credit.
- The third answer replaced an earlier drafting assumption that deactivation was rating-neutral.
  It reshaped the model into a state-based one — **rating = (memes currently activated and not
  deleted) − (memes deleted)** — stated explicitly under Clarifications → Rating model. The
  rewrite touched FR-004 through FR-011, renumbered every later FR, added SC-004
  (path-independence), and forced one derived decision (FR-009: hard delete releases the
  activation credit) without which the score would depend on whether a moderator happened to
  deactivate before purging.
- The `smallint` storage type named in the feature description was deliberately kept out of
  the spec body (implementation detail) and left to `/speckit-plan`. FR-001 states the
  behavioural requirement — signed whole number, default 0 — and FR-011a now defines
  saturation at the bounds of whichever range the plan picks.
- **Scope flag for planning**: the upload path does not exist yet, so FR-015 through FR-020
  are a forward contract rather than something implementable end-to-end now. `/speckit-plan`
  should decide explicitly whether this feature ships rating storage plus adjustments only
  (FR-001–FR-014, fully testable today), or additionally lands a placeholder creation path to
  exercise the auto-activation rule. This is recorded in the spec's Dependencies section.
- A second clarification round on 2026-07-20 added four more answers: the launch baseline stays
  at 0 with the rating model scoped to post-launch events (which required scoping SC-003 and
  widening SC-005's attributable range to −2..0 for pre-existing memes); the rating surfaces as
  a column on the feature-010 meme moderation table with an accounts list deferred; no actor
  including admins may set a rating directly (FR-003 tightened); and ratings saturate at the
  stored bounds (new FR-011a). FR-021 and SC-007 were rewritten around the moderation table.
