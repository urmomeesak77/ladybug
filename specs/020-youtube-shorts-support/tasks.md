---
description: "Task list for feature 020 — YouTube Shorts Support"
---

# Tasks: YouTube Shorts Support

**Input**: Design documents from `/specs/020-youtube-shorts-support/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-posts.md, quickstart.md

**Tests**: INCLUDED. The Ladybug Constitution (Principle VII, ≥90% coverage enforced in CI) and
research.md's R6 test-surface table make tests part of this feature's definition of done. Tests
are written first and must FAIL before the matching implementation task (TDD).

**Organization**: Grouped by user story (US1 P1 → US2 P2 → US3 P3), each independently
implementable and testable.

## Path Conventions

Web app, decoupled: `backend/` (Laravel API) + `frontend/` (React SPA). Tests mirror source under
each stack's `tests/` dir. Backend runs in Docker (`php:8.3-cli`); no local PHP.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: None. No new npm/Composer/system dependency, no new project, directory, or component
(research.md R7; plan.md Complexity Tracking is empty). Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one piece of new state every user story reads or writes — the
`trashposts.youtube_is_short` column — must exist and round-trip as a real JSON boolean before any
story-specific code can set or serialize it (data-model.md).

- [X] T001 Create migration `backend/database/migrations/2026_08_06_000000_add_youtube_is_short_to_trashposts_table.php`
  adding a non-nullable `youtube_is_short` boolean column to `trashposts`, default `false`, placed
  `->after('youtube')` (data-model.md). No backfill needed — the default is the correct historical
  value for every pre-existing row.
- [X] T002 [P] In `backend/app/Models/Trashpost.php` add `'youtube_is_short' => 'boolean'` to the
  `casts()` array so the column serializes as a real JSON `true`/`false` (not `0`/`1`) through
  `TrashpostResource`.

**Checkpoint**: Run the migration (`docker compose exec backend php artisan migrate`) before
starting Phase 3 work that reads/writes the column.

---

## Phase 3: User Story 1 - Paste a Shorts link and have it just work (Priority: P1) 🎯 MVP

**Goal**: A `youtube.com/shorts/{id}` link pasted into the existing YouTube upload field is
recognized, accepted, stored, and played back as a vertical (9:16) inline embed — in the feed and
on the permalink — with the surrounding card kept at the same width as a regular post's card
(FR-001–003, FR-005, FR-006).

**Independent Test**: Paste a `youtube.com/shorts/{id}` URL into the upload field, submit with a
title, and confirm the post is created and viewable with a tall, non-letterboxed player — no
separate UI path required (quickstart.md Scenario 1).

### Tests for User Story 1 (write first — must FAIL) ⚠️

- [X] T003 [P] [US1] Extend `backend/tests/Unit/Utils/YoutubeTest.php`: `extractId()` recognizes a
  `youtube.com/shorts/{id}` URL (incl. `www.`/`m.` host, per spec Assumptions); `isShort()` returns
  `true` for a Shorts URL and `false` for watch/`youtu.be`/embed/bare-id/non-YouTube input
  (research.md R6).
- [X] T004 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: posting a
  `youtube.com/shorts/{id}` link succeeds (`201`) and the JSON response includes
  `data.youtube_is_short === true` alongside the extracted bare id (contracts/api-posts.md 201
  response).
- [X] T005 [P] [US1] Extend `backend/tests/Unit/Services/TrashpostServiceTest.php`:
  `createPost(..., isShort: true)` persists `youtube_is_short = true` on the reserved row; the
  existing non-Shorts call sites (default `false`) still pass unmodified.
- [X] T006 [P] [US1] Extend `frontend/tests/lib/youtube.test.ts`: `Youtube.toEmbedUrl()` accepts a
  `youtube.com/shorts/{id}` URL and rebuilds the same fixed-form nocookie embed URL as any other
  recognized form (mirror parity, research.md R2).
- [X] T007 [P] [US1] Extend `frontend/tests/lib/feedModel.test.ts`: `FeedModel.deriveMedia()` maps
  `raw.youtube_is_short` into `media.isShort` on the `youtube`-kind `FeedMedia`, for both `true` and
  `false`/absent `RawPost` values.
- [X] T008 [P] [US1] Extend `frontend/tests/components/MemeMedia.test.tsx`: `YoutubeMedia` applies
  the `meme-media--video-vertical` modifier class to its wrapper only when `media.isShort` is
  `true`; the wrapper keeps only the base `meme-media--video` class when it is `false`.

### Implementation for User Story 1

- [X] T009 [P] [US1] In `backend/app/Utils/Youtube.php` add `'#/shorts/([A-Za-z0-9_-]{11})#'` to
  the `PATTERNS` array (unanchored substring match, host-agnostic, matching the existing `/embed/`
  entry's style) and add `public static function isShort(string $raw): bool`, reusing that same
  pattern to answer whether the raw input was specifically a Shorts URL (research.md R2).
- [X] T010 [P] [US1] In `backend/app/Services/TrashpostService.php` add a `bool $isShort = false`
  parameter to `createPost()` and thread it into `reserve()`, which sets
  `$post->youtube_is_short = $isShort` on the new row alongside `type`/`youtube` (same
  non-mass-assigned pattern already used there).
- [X] T011 [P] [US1] In `backend/app/Http/Resources/TrashpostResource.php` add
  `'youtube_is_short' => (bool) $this->youtube_is_short` to `toArray()`, placed next to the
  existing `'youtube'` entry (data-model.md API surface; depends on T002).
- [X] T012 [US1] In `backend/app/Http/Controllers/TrashpostsApiController.php::store()` compute
  `$isShort` from the **raw** `youtube` input before extraction (`false` when the upload is an
  image or a video, else `Youtube::isShort((string) $request->input('youtube'))`) and pass it
  through to `$this->service->createPost(...)` (depends on T009, T010).
- [X] T013 [P] [US1] In `frontend/src/lib/youtube.ts` add `/\/shorts\/([A-Za-z0-9_-]{11})/` to
  `URL_PATTERNS` (mirror-only addition, research.md R2 — nothing on the frontend parses a raw
  pasted URL, so no `isShort` equivalent is needed here).
- [X] T014 [US1] In `frontend/src/lib/feedModel.ts` add `youtube_is_short: boolean` to `RawPost`,
  add `isShort: boolean` to the `{ kind: 'youtube' }` member of `FeedMedia`, and populate
  `isShort: raw.youtube_is_short` in `deriveMedia()`'s youtube branch (data-model.md frontend
  shapes; depends on T011 for the field this maps from).
- [X] T015 [US1] In `frontend/src/components/MemeMedia.tsx`'s `YoutubeMedia`, add the
  `meme-media--video-vertical` class to the wrapper `<div>` when `media.isShort` is `true` (depends
  on T014).
- [X] T016 [P] [US1] In `frontend/src/styles/theme.css`, after the existing `.meme-media--video`
  block, add:
  ```css
  .meme-media--video.meme-media--video-vertical {
    aspect-ratio: 9 / 16;
    max-width: min(100%, 26rem);
    margin-inline: auto;
  }
  ```
  (research.md R4 — caps a full-width vertical box's height, collapses to full card width on
  narrow viewports, and centers it within the unchanged card width per the resolved clarification).

**Checkpoint**: US1 fully functional — a Shorts link uploads and plays back as a centered, tall
player at the same card width as any other post. Shippable as the MVP.

---

## Phase 4: User Story 2 - Existing Shorts-link rejections start working (Priority: P2)

**Goal**: Confirm, from the member's point of view, that the specific bug (a Shorts URL producing
"Enter a valid YouTube link.") is closed — without introducing a new false-accept for a string that
merely mentions "shorts" (FR-004, spec Edge Cases).

**Independent Test**: Resubmit a Shorts URL that previously produced the validation error; confirm
it's now accepted (quickstart.md Scenario 2). This story adds no new implementation — US1's regex
addition (T009) is the entire fix; these tasks are the regression proof.

### Tests for User Story 2 (write first — must FAIL, then pass once Phase 3 lands) ⚠️

- [X] T017 [US2] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: a value that
  merely contains the word "shorts" without a real `/shorts/{11-char-id}` path (e.g.
  `https://example.com/i-love-shorts`) is still rejected `422` with the existing "Enter a valid
  YouTube link." message on `youtube` — no new failure mode, no new success case (spec Edge Cases).
- [X] T018 [US2] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: a known-good
  regular `watch?v=`/`youtu.be` link is still accepted `201`, unaffected by the new pattern, with
  `data.youtube_is_short === false` in the response (SC-002 regression check; same file as T017,
  sequential).

**Checkpoint**: US1 + US2 verified together — the originally-reported bug is confirmed fixed and no
new false-accept was introduced by widening the pattern.

---

## Phase 5: User Story 3 - Shorts thumbnails and previews look right elsewhere (Priority: P3)

**Goal**: A Shorts-sourced post produces a correct, non-distorted thumbnail anywhere the site
already generates one from a YouTube post — feed cards, admin console, link previews (FR-007).

**Independent Test**: Publish a Shorts post and inspect its feed thumbnail and any admin preview
image; confirm it renders without distortion or errors (quickstart.md Scenario 4). This story needs
no new implementation — `YoutubeThumbnailService::ensure()` is keyed only on the extracted video id
and has no format-specific logic (research.md R5); this task is the proof.

### Tests for User Story 3 (write first — must FAIL, then pass once Phase 3 lands) ⚠️

- [X] T019 [US3] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: a pending
  Shorts upload's thumbnail is fetched and stored on the public disk exactly like a regular YouTube
  post (mirror `test_a_pending_youtube_uploads_thumbnail_stays_on_the_public_disk` with a
  `youtube.com/shorts/{id}` URL in place of the bare id; same file as T017/T018, sequential).

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Run the real CI gates and validate end-to-end.

- [X] T020 [P] Backend gate (Docker): `docker compose exec backend php artisan test --coverage` —
  all green, ≥90% line coverage; `docker compose exec backend ./vendor/bin/pint --test` clean.
- [X] T021 [P] Frontend gate: `cd frontend; npm run lint; npm run test -- --coverage` — all green,
  ≥90% over all of `src/` (edited `youtube.ts`, `feedModel.ts`, `MemeMedia.tsx` covered).
- [X] T022 Run the `quickstart.md` manual validation scenarios 1–5: Shorts upload end-to-end
  (vertical player, unchanged card width), regression (previously-rejected link now works, word-only
  "shorts" still rejected, regular link unaffected), moderation parity (pending/admin visibility),
  thumbnail correctness, and responsive/theme check across mobile/tablet/desktop + light/dark.
  Run 2026-08-06 against the dev stack with a real `youtube.com/shorts/{id}` link: permalink and
  feed render a centered 416×740 (9:16) player inside an unchanged 1248px card next to a regular
  16:9 post, no horizontal overflow, no console errors; the stored Shorts thumbnail is a real
  320×180 JPEG that loads from the public disk. Narrowing the card to 360px collapses the player to
  the full card width at 9:16. The signed-in steps (the `/upload` form itself, admin console
  activation view) are covered by the feature tests at the HTTP layer; the new CSS adds no color
  tokens, so light/dark is unchanged by construction.
- [ ] T023 Dispatch the `commit-quality-verifier` subagent on the staged diff; commit only on PASS
  (Constitution, conventions, ≥90% coverage, Principle VI security, minimal-deps).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; empty.
- **Foundational (Phase 2)**: no dependencies — BLOCKS all user stories (the column must exist
  before it can be set or read).
- **US1 (Phase 3)**: the MVP; depends only on Phase 2.
- **US2 (Phase 4)**: depends on Phase 2 and on US1's `Youtube::PATTERNS`/`isShort()` addition (T009)
  actually existing to prove against; adds tests only, no new implementation.
- **US3 (Phase 5)**: depends on Phase 2 and on US1's `Youtube::extractId()` widening (T009) so a
  Shorts id reaches `YoutubeThumbnailService` unchanged; adds tests only, no new implementation.
- **Polish (Phase 6)**: after all desired stories complete.

### Within Each User Story (TDD)

- Tests (T003–T008, T017–T018, T019) written first and FAIL before their implementation/regression
  target lands.
- Backend: `Youtube.php` (T009) and `TrashpostService.php` (T010) are independent of each other;
  both are needed by the controller (T012). `TrashpostResource.php` (T011) only needs the cast
  (T002).
- Frontend: `feedModel.ts` (T014) needs the API field to exist (T011) to map from; `MemeMedia.tsx`
  (T015) needs the `isShort` type to exist (T014); `theme.css` (T016) is independent CSS.
- Same-file edits are never parallel: `CreatePostTest.php` is extended by T004, T017, T018, T019 in
  that order.

### Parallel Opportunities

- US1 tests T003/T004/T005/T006/T007/T008 run in parallel (different files).
- US1 impl: T009/T010/T011/T013/T016 in parallel (independent files); T012 waits on T009+T010;
  T014 waits on T011; T015 waits on T014.
- Phase 2's T001 and T002 touch different files and can be done in parallel, though T002's cast is
  meaningless until T001's migration has run.

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests first (they must fail):
Task: "Extend YoutubeTest.php — /shorts/ extraction + isShort()"       # T003
Task: "Extend CreatePostTest.php — Shorts link accepted"               # T004
Task: "Extend TrashpostServiceTest.php — youtube_is_short persisted"   # T005
Task: "Extend youtube.test.ts — /shorts/ pattern"                      # T006
Task: "Extend feedModel.test.ts — isShort mapping"                     # T007
Task: "Extend MemeMedia.test.tsx — vertical modifier class"            # T008

# Then the independent-file implementations:
Task: "Youtube.php — /shorts/ pattern + isShort()"                     # T009 [P]
Task: "TrashpostService.php — thread isShort through createPost/reserve" # T010 [P]
Task: "TrashpostResource.php — expose youtube_is_short"                # T011 [P]
Task: "theme.css — .meme-media--video-vertical"                        # T016 [P]
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 (empty) → Phase 2 Foundational (migration + cast) → Phase 3 US1 (detection, threading,
   vertical playback, both stacks) → **STOP and validate** a Shorts link uploads and plays back
   correctly → ship.

### Incremental Delivery

1. US1 → test → demo (MVP: Shorts links just work end-to-end).
2. US2 → test → demo (the original bug report is confirmed closed; no new false-accept).
3. US3 → test → demo (thumbnails confirmed unaffected), then Phase 6 gates + quickstart.

---

## Notes

- `[P]` = different files, no ordering dependency; `[Story]` maps each task to US1/US2/US3.
- No new npm/Composer/system dependency (research.md R7); the only new file is the Phase 2
  migration — everything else is a targeted edit to an existing file (plan.md Structure Decision).
- Backend tests run only on sqlite `:memory:` in Docker; keep `DB_*` out of test config.
- Commit after each logical group; dispatch `commit-quality-verifier` before each commit and commit
  only on PASS.
