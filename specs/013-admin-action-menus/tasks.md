---
description: "Task list for Admin Action Menus implementation"
---

# Tasks: Admin Action Menus

**Input**: Design documents from `/specs/013-admin-action-menus/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-user-delete-api.md, quickstart.md

**Tests**: INCLUDED — Constitution Principle VII mandates ≥90 % line coverage on both stacks (enforced in CI). Test tasks are written before the implementation they cover (TDD).

**Organization**: Grouped by user story (P1 → P2 → P3) so each is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- All paths are repo-relative.

## Path Conventions

Web app — decoupled `backend/` (Laravel 12) + `frontend/` (React 18 + Vite). Tests mirror source under each stack's `tests/` dir (Principle VII).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the ground is ready; this feature adds **no new dependency** (Principle I) and **no migration** (data-model.md).

- [ ] T001 Confirm no new Composer/npm dependency and no migration is introduced: the kebab menu is in-house and orphan/null-actor behaviour is already enforced by the existing `nullOnDelete` FKs on `trashposts.user_id` and `users.disabled_by` (research D4, data-model.md). Verify the target files to be extended exist: `backend/app/Services/UserAdminService.php`, `backend/app/Http/Controllers/Admin/UserAdminController.php`, `backend/routes/api.php`, and `frontend/src/components/admin/` (houses `AdminPagination.tsx`, where the new `ActionMenu.tsx` lands).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared, mouse-usable `ActionMenu` control that BOTH consoles render through. Accessibility & dismissal are layered on in US3; a working mouse menu ships here so US1 and US2 can integrate.

**⚠️ CRITICAL**: US1 and US2 frontend work depends on this phase. (The US1 backend endpoint is independent and may proceed in parallel with this phase.)

- [ ] T002 [P] Write Vitest spec for the shared menu (mouse behaviour only) in `frontend/tests/components/admin/ActionMenu.test.tsx`: renders one `<button>` trigger plus a `role="menu"` of `role="menuitem"` items from an `items` prop (`{ label, icon?, danger?, onChoose }`); clicking the trigger toggles the menu open/closed; clicking an item runs its `onChoose` and closes the menu; an empty `items` array renders **no trigger button** (FR-006). Ensure it FAILS before T003.
- [ ] T003 Implement the shared menu in `frontend/src/components/admin/ActionMenu.tsx` to pass T002: a plain trigger button toggling a `role="menu"` container of `role="menuitem"` buttons built from `items`; each item shows a text label + optional icon + optional destructive emphasis (label always carries the meaning — FR-002); choosing an item calls `onChoose` then closes; empty `items` → render nothing (FR-006). Component owns only open/close + item rendering (research D9); keep it < 50 lines (defer keyboard/dismiss/ARIA to US3).

**Checkpoint**: A shared, mouse-operable menu exists and is unit-tested. US1 and US2 can now integrate it.

---

## Phase 3: User Story 1 - Account actions in a per-row menu, including permanent delete (Priority: P1) 🎯 MVP

**Goal**: Gather each account's actions (Enable/Disable + the new **Delete permanently**) behind the row's kebab menu, and hard-delete an account the admin strictly outranks — orphaning its memes, keeping no trace.

**Independent Test**: As an admin/superuser at `/admin/users`, open the menu on a strictly-lower-ranked row; confirm Enable/Disable still work and that Delete permanently (after a naming confirmation) removes the account, drops the row in place, and leaves that account's memes as owner-less on `/admin/trashposts`.

### Backend — permanent account deletion (independent of Phase 2)

- [ ] T004 [P] [US1] Write unit tests for the delete service in `backend/tests/Unit/Services/UserAdminServiceTest.php`: `destroy` deletes the target when the actor **strictly** outranks it; refuses (`403`, row untouched) for a peer, a higher rank, and self (INV-3); `404` when no account carries the hash (INV-4); the target's uploaded memes survive with `user_id = null` (INV-2); accounts the deleted admin had disabled keep `disabled_at` but lose `disabled_by` (FR-011); no rating adjustment occurs (INV-5); guard runs on the `lockForUpdate`-loaded row inside a transaction (D6). Ensure they FAIL first.
- [ ] T005 [P] [US1] Write feature tests for the endpoint in `backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php`: `DELETE /api/admin/users/{hash}` → `204` on success (row gone, no body); `403` for peer/higher/self; `404` for unknown hash; `401` for guest and `403` for member (shared access boundary); disabled actor → `401` with session invalidated (`EnsureAccountEnabled`); after delete, an owned meme still exists and renders owner-less. Ensure they FAIL first.
- [ ] T006 [US1] Implement `destroy(User $actor, string $hash): void` in `backend/app/Services/UserAdminService.php`: open a transaction, load the target by `hash` (→ `abort(404)` if none) with `lockForUpdate`, apply `$actor->role->outranks($target->role)` (→ `abort(403)` on failure — identical guard to `disable`/`enable`), then `$target->delete()` (hard delete; User has no `SoftDeletes`). No manual meme/`disabled_by` nulling — the FKs handle it (D4). `declare(strict_types=1)`, < 30 lines.
- [ ] T007 [US1] Add `destroy(string $hash)` to `backend/app/Http/Controllers/Admin/UserAdminController.php`: resolve the acting user, call `UserAdminService::destroy`, return `response()->noContent()` (`204`).
- [ ] T008 [US1] Register `Route::delete('/users/{hash}', [UserAdminController::class, 'destroy'])` in `backend/routes/api.php` inside the existing `auth:sanctum` + `role:admin` admin-users group, alongside the 012 disable/enable routes.

### Frontend — account menu + delete wiring (depends on Phase 2)

- [ ] T009 [P] [US1] Add `UserAdminApi.destroy(hash)` test to `frontend/tests/lib/userAdminApi.test.ts`: issues `DELETE /api/admin/users/{hash}` with the CSRF header and returns `{ ok: response.ok }` (mirrors the meme-purge client). FAIL first.
- [ ] T010 [P] [US1] Add tests to `frontend/tests/lib/userAdminModel.test.ts` for `dropRow(rows, hash)` (returns the list without the matching row, others intact) and `deleteConfirmMessage(name)` (message names the target account). FAIL first.
- [ ] T011 [P] [US1] Add a `removeRow(hash)` test to `frontend/tests/hooks/useUserAdmin.test.tsx`: dropping a hash removes exactly that row from hook state in place (mirrors `useModeration.removeRow`). FAIL first.
- [ ] T012 [P] [US1] Add tests to `frontend/tests/components/users/UserActions.test.tsx`: for a strictly-outranked target the row renders `ActionMenu` with Enable **or** Disable (per state, unchanged) plus **Delete permanently** (destructive emphasis, text label); a non-outranked target (peer/higher/self) renders **no menu** and the existing "No permission" text (FR-006); choosing Delete permanently opens the confirm via `useNotice().ask` naming the account and only calls `UserAdminApi.destroy` on confirm (cancel is a no-op — FR-008); a `204` removes the row in place while a non-2xx (incl. `404`) leaves it untouched (D8). FAIL first.
- [ ] T013 [US1] Implement `destroy(hash)` in `frontend/src/lib/userAdminApi.ts` (`DELETE`, returns `{ ok: response.ok }`).
- [ ] T014 [US1] Add `dropRow(rows, hash)` and `deleteConfirmMessage(name)` to `frontend/src/lib/userAdminModel.ts` (mirror `ModerationModel.purgeConfirmMessage`).
- [ ] T015 [US1] Add `removeRow(hash)` to `frontend/src/hooks/useUserAdmin.ts` (mirror `useModeration.removeRow`).
- [ ] T016 [US1] Refactor `frontend/src/components/users/UserActions.tsx` to build the item list (Enable/Disable — unchanged behaviour, FR-014; plus Delete permanently that fires `useNotice().ask` then `UserAdminApi.destroy` and, on `204`, `onRemove(hash)`) and render it through `ActionMenu`; when the list is empty, render the existing "No permission" text and no menu (FR-006).
- [ ] T017 [US1] Thread an `onRemove` callback alongside the existing `onApply` through `frontend/src/components/users/UserRow.tsx` and `frontend/src/components/users/UserTable.tsx`.
- [ ] T018 [US1] Pass `removeRow` from `frontend/src/pages/UserAdminPage.tsx` into `UserTable` so a delete drops the row on the current page without navigation (FR-013).
- [ ] T019 [US1] Add a Playwright slice `frontend/tests/e2e/admin-action-menus.spec.ts` covering the delete-with-confirm happy path (open the row menu → Delete permanently → confirm → `204` → row gone, still on the same page — SC-002) and the refusal state (own/peer/higher row shows "No permission", no menu).

**Checkpoint**: MVP — admins can permanently delete an outranked account, safely and in place; account actions live in the shared menu. Independently demoable.

---

## Phase 4: User Story 2 - Meme moderation actions in the same per-row menu (Priority: P2)

**Goal**: Present the existing moderation actions through the same shared menu — presentation only, zero behaviour change.

**Independent Test**: At `/admin/trashposts`, open a live meme's menu (Activate/Deactivate, Soft delete, Delete permanently) and a soft-deleted meme's menu (Restore, Delete permanently); confirm every action, its confirmation, and its in-place refresh / row-drop outcome is identical to before this feature.

- [ ] T020 [P] [US2] Update `frontend/tests/components/moderation/ModerationActions.test.tsx`: a live meme's menu offers Activate/Deactivate (per state), Soft delete, Delete permanently; a soft-deleted meme's menu offers Restore and Delete permanently only (FR-016); each item shows an icon **and** a text label (FR-015); the existing confirmations (soft-vs-permanent for live, permanent-only for soft-deleted) and the in-place refresh / row-drop outcomes are unchanged (FR-017); a row with no permitted action renders no menu. Update expectations from inline buttons to `role="menuitem"` items. FAIL first.
- [ ] T021 [US2] Refactor `frontend/src/components/moderation/ModerationActions.tsx` to build its existing state-dependent action list and render it through `ActionMenu`, reusing the current confirmations and the existing row-refresh / row-remove handlers **unchanged** (research D9). No change to `useModeration`, `moderationApi`, or any server surface.

**Checkpoint**: Both consoles present per-row actions through one consistent, uncluttered menu. US1 and US2 both functional and independent.

---

## Phase 5: User Story 3 - Accessible, dismissible menu behaviour (Priority: P3)

**Goal**: Make the shared menu fully keyboard-operable, dismissible four ways, and screen-reader-labelled — a cross-cutting quality layered onto the control both consoles already use.

**Independent Test**: With the keyboard only, open a row's menu, traverse and activate an item; separately open a menu and dismiss it via Escape, outside click, and focus loss — each closes it with no action taken; verify the trigger announces it opens a menu and its open state, and every item exposes a text label.

- [ ] T022 [P] [US3] Extend `frontend/tests/components/admin/ActionMenu.test.tsx` with accessibility & dismissal cases: trigger carries `aria-haspopup="menu"`, `aria-expanded` reflecting state, and a text `aria-label`; items are `role="menuitem"` with text labels; opening via `Enter`/`Space`/`ArrowDown` moves focus to the first item; `ArrowUp`/`ArrowDown` roving focus; `Enter`/`Space` activate; `Escape` closes and returns focus to the trigger; pointer-down outside closes; `focusout` whose `relatedTarget` is outside the menu root closes; choosing nothing takes no action (research D2, FR-003–FR-005). FAIL first.
- [ ] T023 [US3] Extend `frontend/src/components/admin/ActionMenu.tsx` to pass T022: add `aria-haspopup="menu"`/`aria-expanded`/`aria-label` on the trigger, roving keyboard navigation, `Enter`/`Space`/`ArrowDown` open with focus-to-first-item, `Escape` close + focus-return, and dismissal on outside pointer-down and on `focusout` leaving the menu root (FR-004). If the keydown/dismiss logic pushes the component past ~50 lines, extract it to a `useMenuKeyboard` hook in `frontend/src/hooks/` (per conventions). No item semantics change.
- [ ] T024 [P] [US3] Extend the Playwright slice `frontend/tests/e2e/admin-action-menus.spec.ts` with US3 coverage: keyboard-only open → arrow-traverse → activate; dismissal via Escape (focus returns to trigger), outside click, and Tab-away focus loss; and assert opening/closing a menu never changes the page URL and does not disturb Back/Forward/Refresh (FR-019, SC-006).

**Checkpoint**: All three stories independently functional; the shared menu is accessible on both consoles.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the whole feature against the Constitution gates and the quickstart.

- [ ] T025 Manual verification of Principles IV & VIII on both consoles' menus: destructive emphasis is never the sole signal (label always reads "Delete permanently" — FR-002); menu button and items keep adequate touch targets and reflow within the admin tables (no horizontal scroll) in light and dark themes at mobile / tablet / desktop widths (quickstart "Manual verification").
- [ ] T026 [P] Update `C:\projects\ladybug\CLAUDE.md` "Current State" with a 013-admin-action-menus summary (shared in-house `ActionMenu`; `DELETE /api/admin/users/{hash}` hard delete guarded by strict rank; memes orphaned via `nullOnDelete`, no audit trail).
- [ ] T027 Run the full gate suite and confirm ≥90 % on both stacks: backend `docker compose run --rm backend php artisan test --coverage`, frontend `cd frontend && npm run lint && npm run test`, and `npx playwright test admin-action-menus` (quickstart "Automated checks"). Fix any gap.
- [ ] T028 Execute the quickstart.md scenarios 1–6 end-to-end (happy-path delete, memes survive owner-less, refusal + rank-change re-check, concurrent/already-deleted `404`, moderation menu parity, accessibility & dismissal + URL stability) and confirm each passes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: After Setup. Blocks the **frontend** of US1 and US2. Does **not** block the US1 backend (T004–T008).
- **US1 (Phase 3)**: Backend (T004–T008) after Setup; frontend (T009–T019) after Foundational.
- **US2 (Phase 4)**: After Foundational. Independent of US1 (presentation reuse of the same `ActionMenu`).
- **US3 (Phase 5)**: Layers onto the `ActionMenu` from Foundational; best validated after US1/US2 give it real call sites, but the component work depends only on Phase 2.
- **Polish (Phase 6)**: After all desired stories complete.

### User Story Dependencies

- **US1 (P1)**: Backend independent of everything but Setup; frontend needs Foundational. No dependency on US2/US3.
- **US2 (P2)**: Needs Foundational only. Independent of US1 and US3.
- **US3 (P3)**: Needs Foundational; enhances the shared control US1/US2 render — independently testable via the menu on either console.

### Within Each Story

- Tests are written first and must FAIL before the implementation task they cover (TDD).
- Backend: service (T006) → controller (T007) → route (T008).
- Frontend: api/model/hook (T013–T015) → components (T016–T017) → page wiring (T018).

### Parallel Opportunities

- **US1 backend (T004–T008)** and **Foundational (T002–T003)** can proceed in parallel (different stacks).
- All `[P]` test tasks within a story touch different files and can run together.
- US1 frontend leaf modules T013, T014, T015 are independent once Foundational is done.
- US2 (T020–T021) can run in parallel with US1 frontend once Foundational is complete.

---

## Parallel Example: User Story 1

```bash
# Backend tests (write first, expect FAIL) — parallel, different files:
Task: "Unit tests for destroy in backend/tests/Unit/Services/UserAdminServiceTest.php"
Task: "Feature tests for DELETE endpoint in backend/tests/Feature/Http/Controllers/Admin/UserAdminControllerTest.php"

# Frontend tests (write first, expect FAIL) — parallel, different files:
Task: "UserAdminApi.destroy test in frontend/tests/lib/userAdminApi.test.ts"
Task: "dropRow/deleteConfirmMessage tests in frontend/tests/lib/userAdminModel.test.ts"
Task: "removeRow test in frontend/tests/hooks/useUserAdmin.test.tsx"
Task: "UserActions menu + confirm tests in frontend/tests/components/users/UserActions.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup.
2. Phase 2: Foundational (shared `ActionMenu`).
3. Phase 3: US1 — account menu + permanent delete.
4. **STOP and VALIDATE**: quickstart Scenarios 1–4 pass independently.
5. Deploy/demo — the headline capability (safe permanent account deletion) is live.

### Incremental Delivery

1. Setup + Foundational → shared menu ready.
2. US1 → the new delete capability (MVP).
3. US2 → moderation console reuses the menu (consistency).
4. US3 → full keyboard/AT accessibility across both consoles.
5. Polish → coverage gate + quickstart validation.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- This feature adds **no migration and no new dependency**; orphan/null-actor behaviour is guaranteed by existing `nullOnDelete` FKs (data-model.md, research D4).
- Backend runs through the `php:8.3-cli`/Docker container on sqlite `:memory:` — never the real DB (project convention).
- Per project workflow, dispatch the `commit-quality-verifier` agent before each phase commit and commit only on PASS.
- Verify each test fails before writing its implementation; commit after each task or logical group.
