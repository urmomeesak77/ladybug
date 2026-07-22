---
description: "Task list for feature 014 — Upload Page Polish"
---

# Tasks: Upload Page Polish

**Input**: Design documents from `/specs/014-upload-page-polish/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/upload.md, quickstart.md

**Tests**: INCLUDED. The Ladybug Constitution (Principle VII, ≥90% coverage enforced in CI) and
the contract's enumerated test files make tests part of this feature's definition of done. Tests
are written first and must FAIL before the matching implementation task (TDD).

**Organization**: Grouped by user story (US1 P1 → US2 P2 → US3 P3), each independently
implementable and testable.

## Path Conventions

Web app, decoupled: `backend/` (Laravel API) + `frontend/` (React SPA). Tests mirror source under
each stack's `tests/` dir. Backend runs in Docker (`php:8.3-cli`); no local PHP.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Orientation only — the stacks are already scaffolded and this feature adds **no new
npm/Composer package**. The single environment change (ImageMagick + GD `--with-webp`) is
US3-specific and lives in Phase 5, so US1/US2 are not blocked by it.

- [X] T001 Confirm the reusable auth-form primitives exist and note them for reuse: `.auth` /
  `.auth-form` / `.auth-field` in `frontend/src/styles/theme.css`, and the `AuthField` +
  `BusyButton` components in `frontend/src/components/`. No code change — this grounds US1's
  "read as one family" visual reuse (research R6).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. This feature edits existing modules and adds three small units; the three user
stories are independent and share no new blocking infrastructure. Proceed directly to Phase 3.

**Checkpoint**: No foundational work — user story implementation can begin immediately.

---

## Phase 3: User Story 1 - A polished upload form with a required title (Priority: P1) 🎯 MVP

**Goal**: The upload form reads as one family with login/register (heading exactly "Upload", the
shared `.auth`/`.auth-form` treatment) and a title becomes **required**, enforced client-side and
authoritatively in `CreatePostRequest`.

**Independent Test**: Sign in as a verified member, open `/upload` — heading reads "Upload", the
form matches the auth forms' layout, and posting with an empty or whitespace-only title is refused
with a field-level "required" message (no meme created).

### Tests for User Story 1 (write first — must FAIL) ⚠️

- [X] T002 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: title
  omitted ⇒ `422` with `errors.title` and **no** `Trashpost` created; title whitespace-only ⇒
  `422` with `errors.title`; existing valid-title happy path still `201` (per contract §1 tests).
- [X] T003 [P] [US1] Extend `frontend/tests/lib/uploadModel.test.ts`: `UploadModel.validate`
  flags a missing title and a whitespace-only title (trimmed) with a field-level message.
- [X] T004 [P] [US1] Extend `frontend/tests/hooks/useUploadForm.test.tsx`: an empty/whitespace
  title blocks `submit()` (no API call) and exposes `errors.title`.
- [X] T005 [P] [US1] Extend `frontend/tests/pages/UploadPage.test.tsx`: the page heading is
  **exactly** "Upload"; submitting with an empty title shows the field-level error and does not
  submit.

### Implementation for User Story 1

- [X] T006 [P] [US1] In `backend/app/Http/Requests/CreatePostRequest.php` change the `title` rule
  from `['nullable','string','max:255']` to `['required','string','max:255']` (research R4;
  `TrimStrings` middleware makes whitespace-only ⇒ empty ⇒ fails `required`).
- [X] T007 [P] [US1] In `frontend/src/lib/uploadModel.ts` add a trimmed required-title check to
  `UploadModel.validate` returning a field-level `title` message when empty/whitespace.
- [X] T008 [US1] In `frontend/src/hooks/useUploadForm.ts` surface the required-title error and
  short-circuit `submit()` when validation fails (depends on T007).
- [X] T009 [US1] In `frontend/src/pages/UploadPage.tsx`: change heading to exactly `Upload`; wrap
  the page in `<section className="auth">` reusing `.auth-form`; change the `AuthField` label from
  `"Title (optional)"` to `"Title"` (required). Leave the existing radio media toggle in place for
  now — US2 replaces it (depends on T008).

**Checkpoint**: US1 fully functional — polished, auth-consistent form with an authoritative
required title. Shippable as the MVP.

---

## Phase 4: User Story 2 - Choosing Image vs YouTube with tabs (Priority: P2)

**Goal**: Replace the radio media-type toggle with a WAI-ARIA **tablist** ("Image" default,
"YouTube"); only the active tab's panel/input is rendered and submitted, keyboard-operable, with a
non-color selected affordance.

**Independent Test**: On `/upload`, two tabs show with exactly one selected (Image default);
switching reveals only that tab's input; keyboard Left/Right/Home/End operate the tablist; a value
entered in one tab then switching submits only the active tab's value and drops the departed tab's
stale error.

### Tests for User Story 2 (write first — must FAIL) ⚠️

- [X] T010 [P] [US2] Create `frontend/tests/components/MediaTabs.test.tsx`: renders two tabs with
  Image `aria-selected="true"` by default; clicking YouTube flips `aria-selected` and swaps the
  `role="tabpanel"`; exactly one tabpanel is in the DOM (contract §2).
- [X] T011 [P] [US2] Create `frontend/tests/hooks/useTabsKeyboard.test.tsx`: Left/Right move
  selection, Home/End jump to first/last, roving `tabIndex` is `0` on selected and `-1` on the
  other.
- [X] T012 [P] [US2] Extend `frontend/tests/pages/UploadPage.test.tsx`: switching media tabs
  clears the departed input's stale field error (edge case) and submits only the active tab's
  value.

### Implementation for User Story 2

- [X] T013 [P] [US2] Create `frontend/src/hooks/useTabsKeyboard.ts`: roving-tabindex Left/Right/
  Home/End handler for the tablist (mirror the shape of `frontend/src/hooks/useMenuKeyboard.ts`).
- [X] T014 [US2] Create `frontend/src/components/MediaTabs.tsx`: `role="tablist"` (accessible
  name) with two `role="tab"` buttons (`aria-selected`, `aria-controls`, `id`, roving `tabIndex`)
  and one rendered `role="tabpanel"` (`aria-labelledby`) for the active tab (depends on T013).
- [X] T015 [US2] In `frontend/src/pages/UploadPage.tsx` replace the radio `fieldset` with
  `<MediaTabs>`, rendering `UploadMediaField` inside the active tabpanel (depends on T014).
- [X] T016 [US2] In `frontend/src/hooks/useUploadForm.ts` clear the departed tab's field error
  when `setMode` switches tabs (so no stale error lingers against a hidden input).
- [X] T017 [P] [US2] In `frontend/src/styles/theme.css` add a theme-aware, responsive
  `.media-tabs` block: non-color selected affordance (underline/weight), ≥2.75rem touch targets,
  no horizontal scroll 320px→desktop.

**Checkpoint**: US1 + US2 both work independently — auth-consistent form with accessible tabs.

---

## Phase 5: User Story 3 - Posting a WebP image (Priority: P3)

**Goal**: Accept WebP end-to-end. Static WebP flows through the existing GD path (rebuilt
`--with-webp`); **animated** WebP is resized frame-preserving via ImageMagick (`convert`),
mirroring the animated-GIF/`gifsicle` precedent.

**Independent Test**: On the Image tab the picker accepts `.webp`; a valid static WebP + title is
created with `.webp` variants and renders in feed/permalink; a valid animated WebP + title keeps
its animation in every size variant; a malformed/oversized "webp" is rejected `422`.

### Environment setup for User Story 3

- [ ] T018 [US3] In `docker/php/Dockerfile` add the `imagemagick` apt package and `libwebp-dev`,
  and rebuild GD with `--with-webp`; record the owner-approved ImageMagick rationale in a comment
  (research R1/R2). Rebuild: `docker compose build backend && docker compose up -d backend`.
- [ ] T019 [P] [US3] In `.github/workflows/ci.yml` install `imagemagick` in **both** the `backend`
  job (extend the gifsicle step) and the `e2e` job image, and assert GD WebP support in the
  `backend` job. The backend coverage gate (T032, Principle VII) exercises `WebpFile`'s real
  `convert` call, so imagemagick must be present there — not only in e2e; the WebP e2e spec needs
  it in the e2e image.
- [ ] T020 [P] [US3] Add WebP test fixtures — one valid **static** `.webp` and one valid
  **animated** (multi-frame) `.webp` — alongside the existing image fixtures used by
  `CreatePostTest` / `ImageFileTest` under `backend/tests/`.

### Tests for User Story 3 (write first — must FAIL) ⚠️

- [ ] T021 [P] [US3] Create `backend/tests/Unit/Support/WebpFileTest.php`: `WebpFile::isAnimated`
  returns `false` for the static fixture and `true` for the animated one; the resize produces a
  downscaled variant whose frame count is > 1 for the animated input.
- [ ] T022 [P] [US3] Extend `backend/tests/Unit/Support/ImageFileTest.php`: the WebP read/write
  branch (`imagecreatefromwebp` / `imagewebp`) scales and writes a valid `.webp`.
- [ ] T023 [P] [US3] Extend `backend/tests/Unit/Services/TrashpostImageProcessorTest.php`:
  `image/webp` maps to the `webp` stored extension; a **static** WebP dispatches to `ImageFile`
  and an **animated** WebP dispatches to `WebpFile`.
- [ ] T024 [P] [US3] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: valid
  static WebP + title ⇒ `201` with `.webp` original + variants; valid animated WebP + title ⇒
  `201` with every variant animated (frame count > 1); malformed "webp" ⇒ `422` `errors.image`.
- [ ] T025 [P] [US3] Extend `frontend/tests/components/UploadMediaField.test.tsx`: the image file
  input's `accept` includes `image/webp`.

### Implementation for User Story 3

- [ ] T026 [P] [US3] In `backend/app/Support/ImageFile.php` add WebP read (`imagecreatefromwebp`)
  and write (`imagewebp`) branches; `imagescale` handles the resize (research R2).
- [ ] T027 [P] [US3] Create `backend/app/Support/WebpFile.php`: `isAnimated(path)` via in-house
  RIFF/`VP8X` header parse (research R3) and a frame-preserving resize invoking ImageMagick
  through a Symfony `Process` **argv array** (`convert in -coalesce -resize {w}x -layers optimize
  out`) — never a shell string; `declare(strict_types=1)`, methods ≤30 lines (mirror `GifFile`).
- [ ] T028 [US3] In `backend/app/Services/TrashpostImageProcessor.php` map the validated
  `image/webp` MIME to the `webp` extension and dispatch static→`ImageFile`, animated→`WebpFile`;
  size-variant set, `MediaPath` layout, never-upscale, and rollback-on-failure unchanged (depends
  on T026, T027).
- [ ] T029 [P] [US3] In `backend/app/Http/Requests/CreatePostRequest.php` add `webp` to the
  `image` rule's `mimes:` list (keep `max:10240` and `image` well-formedness — nothing else
  relaxed, FR-013).
- [ ] T030 [P] [US3] In `frontend/src/components/UploadMediaField.tsx` add `image/webp` to the
  file input's `accept` attribute.

### End-to-end for User Story 3

- [ ] T031 [US3] Extend `frontend/tests/e2e/upload.spec.ts`: WebP upload succeeds and appears; the
  required-title rule and tab-switch behavior are exercised end-to-end (runs via `scripts\e2e.ps1`
  against the isolated stack; needs T018/T019).

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Run the real CI gates and validate end-to-end.

- [ ] T032 [P] Backend gate (Docker): `docker compose exec backend php artisan test --coverage` —
  all green, ≥90% line coverage; `docker compose exec backend ./vendor/bin/pint --test` clean.
- [ ] T033 [P] Frontend gate: `cd frontend; npm run lint; npm run test -- --coverage` — all green,
  ≥90% over all of `src/` (new `MediaTabs`, `useTabsKeyboard`, and edited modules covered).
- [ ] T034 E2E gate: `scripts\e2e.ps1` — the upload spec (WebP + required-title + tab-switch)
  passes against the isolated stack with imagemagick + libwebp present.
- [ ] T035 Run the `quickstart.md` manual validation scenarios (US1/US2/US3 + SC-006 regression:
  JPEG/PNG/animated-GIF/YouTube still succeed with the new required title).
- [ ] T036 Dispatch the `commit-quality-verifier` subagent on the staged diff; commit only on PASS
  (Constitution, conventions, ≥90% coverage, Principle VI security, minimal-deps).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: none — no blocking prerequisites.
- **US1 (Phase 3)**: the MVP; independent.
- **US2 (Phase 4)**: independent, but T015 edits `UploadPage.tsx` which US1's T009 also edits — do
  US1 before US2 to avoid a same-file conflict (logical independence preserved).
- **US3 (Phase 5)**: independent; T029 edits `CreatePostRequest.php` also touched by US1's T006 —
  sequence them. T018/T019 environment change gates the US3 backend/e2e gates going green.
- **Polish (Phase 6)**: after all desired stories complete.

### Within Each User Story (TDD)

- Tests (T002–T005, T010–T012, T021–T025) written first and FAIL before their implementation.
- Backend request rule and frontend model/hook/page are logically independent files; `[P]` marks
  the ones with no ordering constraint. Hook depends on model; page depends on hook/component.
- US3: `ImageFile` (T026) + `WebpFile` (T027) before the processor dispatch (T028).

### Parallel Opportunities

- US1 tests T002/T003/T004/T005 run in parallel (different files).
- US2 tests T010/T011/T012 in parallel; impl T013 and T017 (CSS) in parallel.
- US3 tests T021/T022/T023/T024/T025 in parallel; impl T026/T027/T029/T030 largely parallel
  (T028 waits on T026+T027).
- Same-file edits are never parallel: `UploadPage.tsx` (T009→T015), `useUploadForm.ts` (T008→T016),
  `CreatePostRequest.php` (T006→T029).

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests first (they must fail):
Task: "Extend CreatePostTest.php — required-title cases"           # T002
Task: "Extend uploadModel.test.ts — trimmed required-title"        # T003
Task: "Extend useUploadForm.test.tsx — blocked submit"             # T004
Task: "Extend UploadPage.test.tsx — heading + title error"         # T005

# Then the independent-file implementations:
Task: "CreatePostRequest title required (backend)"                 # T006 [P]
Task: "uploadModel.validate required-title (frontend)"             # T007 [P]
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup → 2. (Foundational is empty) → 3. US1 (heading + `.auth` layout + required
   title, both stacks) → **STOP and validate** the polished, required-title form → ship.

### Incremental Delivery

1. US1 → test → demo (MVP: consistent form + required title).
2. US2 → test → demo (accessible Image/YouTube tabs).
3. US3 → test → demo (WebP incl. animated), then Phase 6 gates + quickstart.

---

## Notes

- `[P]` = different files, no ordering dependency; `[Story]` maps each task to US1/US2/US3.
- No new npm/Composer dependency. The only new dependency is the system CLI **ImageMagick**
  (owner-approved 2026-07-22) plus GD `--with-webp` (enabling a format on the present library).
- Backend tests run only on sqlite `:memory:` in Docker; keep `DB_*` out of test config.
- Commit after each logical group; dispatch `commit-quality-verifier` before each commit and
  commit only on PASS.
