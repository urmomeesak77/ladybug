# Feature Specification: Admin Action Menus

**Feature Branch**: `013-admin-action-menus`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Admin action menus (kebab dropdown) for the admin user list and trashpost moderation list, plus permanent hard-delete of a user account."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Account actions in a per-row menu, including permanent delete (Priority: P1)

An admin browsing the accounts console wants every action they can take on an
account gathered behind a single, unobtrusive control instead of a button
sitting in the row. Opening the control reveals the actions available for that
account — enabling or disabling access, and permanently deleting the account —
and choosing permanent delete requires an explicit confirmation because it
cannot be undone.

**Why this priority**: This is the only story that adds a genuinely new
capability (permanent account deletion) on top of a UI reshaping. It delivers
the headline value: admins can remove an account for good, safely, from where
they already work. Shipping just this story yields a usable, valuable increment.

**Independent Test**: Sign in as an admin, open the accounts console, open the
menu on an account ranked below you, and confirm both that Enable/Disable still
work as before and that Delete permanently removes the account (after
confirmation) and drops it from the list without navigating away.

**Acceptance Scenarios**:

1. **Given** an admin viewing an account they strictly outrank, **When** they open that row's actions menu, **Then** the menu offers Enable-or-Disable (whichever the account's current state calls for) and Delete permanently.
2. **Given** the actions menu is open, **When** the admin chooses Delete permanently, **Then** a blocking confirmation appears naming the account, and nothing is deleted unless the admin confirms.
3. **Given** the admin confirms the permanent delete, **Then** the account is removed for good, the row disappears from the current page without a full navigation, and the admin stays on the same page.
4. **Given** an account the admin does NOT strictly outrank (a peer, a higher rank, or the admin's own row), **When** the admin looks at that row, **Then** no actions menu is offered and the existing "No permission" text is shown instead.
5. **Given** a permanently deleted account that had uploaded memes, **When** an admin later views the moderation console, **Then** those memes still exist and are shown as having no owning account (they are not deleted along with the account).

---

### User Story 2 - Meme moderation actions in the same per-row menu (Priority: P2)

An admin moderating memes wants the per-row controls presented the same way as
on the accounts console — a single control that opens a menu of the actions
valid for that meme's current state — so the two consoles feel consistent and
the row stays uncluttered.

**Why this priority**: This is a pure presentation change over existing,
working moderation actions. It improves consistency and reduces row clutter but
adds no new capability, so it ranks below the story that introduces permanent
account deletion. It is independently shippable and testable.

**Independent Test**: Open the moderation console, open a meme's actions menu,
and confirm every action available before the change (activate/deactivate, soft
delete, restore, permanent delete) is present and behaves identically, including
the existing confirmations.

**Acceptance Scenarios**:

1. **Given** a live meme in the moderation console, **When** the admin opens its actions menu, **Then** the menu offers Activate or Deactivate (per current state), Soft delete, and Delete permanently, each labelled with text (and an icon).
2. **Given** a soft-deleted meme, **When** the admin opens its actions menu, **Then** the menu offers Restore and Delete permanently only.
3. **Given** any deletion action is chosen from the menu, **Then** the same confirmation behaviour as before this feature is presented (soft-vs-permanent choice for a live meme; permanent-only for an already-soft-deleted meme) and the meme's data is unchanged unless confirmed.
4. **Given** an admin activates, deactivates, restores, or deletes a meme from the menu, **Then** the outcome is exactly what the equivalent pre-feature control produced (the row refreshes in place, or is dropped on a permanent delete).

---

### User Story 3 - Accessible, dismissible menu behaviour (Priority: P3)

Any admin, including keyboard and assistive-technology users, wants the actions
menu to be fully operable without a mouse and to get out of the way as soon as
they are done with it.

**Why this priority**: The menus in US1 and US2 are unusable for some admins
without this behaviour, but it is a cross-cutting quality of the shared control
rather than a standalone user-facing feature, so it is validated on top of the
first two stories.

**Independent Test**: Using only the keyboard, open a row's menu, move through
its items, activate one, and separately open a menu and dismiss it via Escape,
by clicking elsewhere, and by moving focus away — confirming each closes it.

**Acceptance Scenarios**:

1. **Given** keyboard focus on a row's menu control, **When** the admin activates it with the keyboard, **Then** the menu opens and its items are reachable and operable by keyboard.
2. **Given** an open menu, **When** the admin presses Escape, clicks outside the menu, or moves focus out of it, **Then** the menu closes and no action is taken.
3. **Given** the menu control and its items, **When** inspected by assistive technology, **Then** the control announces that it opens a menu and whether it is open, and every item exposes a text label — no action relies on colour alone.

---

### Edge Cases

- **Concurrent delete**: If an account is permanently deleted by one admin and a second admin then acts on the same (now-gone) row, the second action fails cleanly (the target no longer exists) rather than corrupting state; the second admin's list corrects on its next refresh.
- **Rank changes between render and action**: Permission is re-checked when the action is performed, not just when the menu was drawn, so an admin who no longer outranks a target (e.g. the target was promoted) is refused even if their stale menu still showed the item.
- **Self and equal/higher ranks**: The permanent-delete and disable/enable actions are all refused for the admin's own account, for peers of equal rank, and for higher ranks — surfaced as the "No permission" state with no menu.
- **Deleting an admin who had disabled others**: When an account that previously disabled other accounts is permanently deleted, the affected accounts are unaffected except that they no longer name a disabling actor.
- **Empty menu**: If, for a given row, no action is permitted, no menu control is shown at all (the row falls back to its no-permission text) rather than an empty menu that opens to nothing.
- **Menu open when the row updates**: Choosing an item closes the menu; the menu never lingers open over a row whose state has just changed.

## Requirements *(mandatory)*

### Functional Requirements

#### Shared actions menu

- **FR-001**: Each applicable row in the accounts console and the moderation console MUST present its per-row actions behind a single compact "more actions" control (a three-dot / kebab affordance) that opens a menu of actions, rather than as inline buttons.
- **FR-002**: The actions menu MUST support items that carry a text label, an optional icon, and an optional emphasis marking an irreversible/destructive action; the destructive emphasis MUST never be the sole signal of meaning (the text label always conveys the action).
- **FR-003**: The actions menu MUST be operable by keyboard: it can be opened, its items traversed and activated, and it can be closed, all without a pointing device.
- **FR-004**: The actions menu MUST close when an item is chosen, when the user presses Escape, when the user clicks outside it, or when focus leaves it — and choosing no item MUST take no action.
- **FR-005**: The menu control MUST expose, to assistive technology, that it opens a menu and whether it is currently open; menu items MUST expose their text labels.
- **FR-006**: When a row has no permitted actions, the menu control MUST NOT be shown; the row MUST fall back to the existing "No permission" indication.

#### Accounts console (permanent account deletion)

- **FR-007**: For an account the acting admin strictly outranks, the account's actions menu MUST offer the applicable Enable-or-Disable action (unchanged in behaviour) and a Delete-permanently action.
- **FR-008**: The Delete-permanently action MUST require an explicit, blocking confirmation that names the target account before anything is deleted; cancelling MUST leave the account untouched.
- **FR-009**: The system MUST permanently delete an account only when the acting admin strictly outranks the target account. Peers of equal rank, higher ranks, and the admin's own account MUST be refused, and this permission MUST be re-checked at the moment the deletion is performed (not only when the menu was displayed).
- **FR-010**: Permanent account deletion MUST remove the account itself only. Memes the account uploaded MUST NOT be deleted; they MUST remain and thereafter be shown as having no owning account.
- **FR-011**: After a permanent deletion, any other accounts that the deleted admin had previously disabled MUST remain in their current state, no longer naming a disabling actor.
- **FR-012**: Attempting to permanently delete an account that does not exist (e.g. already deleted) MUST fail cleanly without affecting other data.
- **FR-013**: On a successful permanent deletion, the deleted account's row MUST be removed from the currently displayed page in place, without forcing a full-page navigation or losing the admin's position.
- **FR-014**: Enable and Disable, when invoked from the menu, MUST behave exactly as they did before this feature (reversible, no confirmation, same permission rule).

#### Moderation console (menu reshaping only)

- **FR-015**: The moderation console's per-row actions MUST be presented through the same menu control, with each item shown as an icon together with a text label.
- **FR-016**: The set of actions offered for a meme MUST continue to reflect its current state exactly as before this feature: a live meme offers Activate/Deactivate, Soft delete, and Delete permanently; a soft-deleted meme offers Restore and Delete permanently.
- **FR-017**: Every moderation action invoked from the menu MUST preserve its existing behaviour and existing confirmations, including the soft-vs-permanent delete choice for a live meme and the permanent-only confirmation for an already-soft-deleted meme, and the existing in-place row refresh / row removal outcomes.

#### Cross-cutting

- **FR-018**: Every account and meme referenced by an action MUST be identified by its existing public handle, never by an internal database identifier.
- **FR-019**: The menus are transient interface state only; opening or closing a menu MUST NOT change the page's shareable location or its Back/Forward/Refresh behaviour.

### Key Entities *(include if feature involves data)*

- **Account**: A registered user, identified publicly by its opaque handle, carrying a role (which determines who may act on it), an access state (enabled or disabled), and an ownership link to any memes it uploaded. Permanent deletion removes the account record; the ownership link on its memes is cleared rather than cascading the deletion to the memes.
- **Meme (moderation entry)**: An uploaded entry identified by its public handle, with a lifecycle state (live / deactivated / soft-deleted) that determines which moderation actions apply. Unchanged by this feature except that a meme may become owner-less when its uploader's account is permanently deleted.
- **Actions menu**: A transient per-row control listing the actions valid for that row given the viewer's permissions and the row's state. Not persisted; carries no shareable state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On both consoles, every per-row action available before this feature remains reachable, now via the row's actions menu, with no action lost or changed in outcome.
- **SC-002**: An admin can permanently delete an account they outrank, with confirmation, in no more than three interactions from the row (open menu → choose delete → confirm).
- **SC-003**: 100% of permanent-account-delete attempts against a peer, a higher rank, or the admin's own account are refused, with no such account ever deleted.
- **SC-004**: After a permanent account deletion, 100% of memes the account had uploaded still exist and are shown as owner-less; none are removed.
- **SC-005**: Every menu action is reachable and operable using only the keyboard, and every menu can be dismissed by Escape, outside click, and focus loss.
- **SC-006**: Opening or closing any menu never changes the page's URL and never disturbs Back/Forward/Refresh restoration of the page.

## Assumptions

- Permanent account deletion follows the same strict-rank permission rule already used for disabling/enabling accounts; no new, separate permission concept is introduced.
- "Orphan the memes" is the intended meaning of account deletion (confirmed with the requester): the account's uploaded memes are kept and become owner-less, not cascade-deleted, and their stored media is untouched.
- The existing confirmation mechanism used by moderation deletes is reused for the new permanent-account-delete confirmation; no new confirmation surface is introduced.
- The moderation console change is presentation-only; the existing moderation actions, their server behaviour, and their confirmations are reused unchanged.
- One shared menu control serves both consoles; it is built in-house with no new third-party dependency.
- Admin-console access continues to be gated to admin-or-higher callers as today; this feature does not change who can reach the consoles, only the per-row controls within them.
