---
description: "Task list for feature: Media Storage Location (Seed from Prototype)"
---

# Tasks: Media Storage Location (Seed from Prototype)

**Input**: Design documents from `/specs/003-media-storage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. Constitution Principle VII (≥90% coverage, tests mirror source) and
plan.md both require the two test files; TDD ordering applies (write the failing test
before the implementation it covers).

**Organization**: Tasks are grouped by user story. The shared, pure `MediaPath` helper is
Foundational (both stories rest on it); the seed command is US1; the documented
destination + video convention is US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2 (Setup/Foundational/Polish carry no story label)
- All paths are relative to the repo root; backend code lives under `backend/`

## Path Conventions

- Web app, backend-only feature: source in `backend/app/`, tests in `backend/tests/`
- Helper: `backend/app/Support/MediaPath.php` (mirrors existing `PublicCode.php`)
- Command: `backend/app/Console/Commands/SeedMediaCommand.php`
- Unit test: `backend/tests/Unit/Support/MediaPathTest.php`
- Feature test: `backend/tests/Feature/Console/SeedMediaCommandTest.php`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the prerequisites that all later work assumes are in place

- [ ] T001 [P] Verify `backend/storage/app/public/.gitignore` excludes all media (contains `*` + `!.gitignore`) so seeded images and future videos under `image/trash/` and `video/trash/` are never stageable; leave it unchanged (satisfies FR-010 / SC-006). Confirm `backend/app/Support/PublicCode.php` exists as the helper pattern to mirror.

**Checkpoint**: Backend scaffold (feature 002) confirmed; version-control exclusion in place.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure, I/O-free `App\Support\MediaPath` path/shard logic that BOTH user
stories depend on. The seed command (US1) cannot run without it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Write failing unit test `backend/tests/Unit/Support/MediaPathTest.php` covering the image/shared API per contracts/media-layout.md: `imageSizes()` returns ordered `original,800,500,300,100`; `shardFor()` lowercases the first char and returns `other` for non-`[a-z0-9]` leads (`1dcmpenbnr.jpg`→`1`, `Abc.png`→`a`, `_hidden.gif`→`other`, `-dash.jpeg`→`other`); `isMediaFile()` accepts `jpg,jpeg,png,gif` case-insensitively and rejects `.gitignore`/other extensions; `imageRelativePath(size, code, ext)`→`image/trash/{size}/{shard}/{code}.{ext}`. Run and confirm it FAILS (class absent).
- [ ] T003 Implement `backend/app/Support/MediaPath.php` with `imageSizes()`, `shardFor()`, `isMediaFile()`, and `imageRelativePath()` to pass T002. `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, functions < 30 lines, braces on single-line bodies, comments explain *why*. Mirror the structure of `backend/app/Support/PublicCode.php`. No I/O.

**Checkpoint**: `MediaPath` exists and is green — user stories can now begin.

---

## Phase 3: User Story 1 - Existing images available at the canonical location (Priority: P1) 🎯 MVP

**Goal**: Copy every prototype image (all size variants, shard structure intact) into
`backend/storage/app/public/image/trash/` via `php artisan media:seed`, idempotently, and
emit a verification report proving a byte-for-byte, count-matching copy.

**Independent Test**: Run `php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash"`;
a known code resolves under each size that exists for it, and the report shows per-size
counts matching the source with 0 checksum mismatches and 0 stray files (exit 0). A second
run copies nothing and still reports OK.

### Tests for User Story 1

> Write first, ensure it FAILS before implementation.

- [ ] T004 [P] [US1] Write failing feature test `backend/tests/Feature/Console/SeedMediaCommandTest.php` using `Storage::fake('public')` + a small temp source fixture tree (a few sizes/shards, mixed `jpg/png/gif`, plus a stray `.gitignore`). Assert per contracts/seed-media-command.md: media files copied to `image/trash/{size}/{shard}/{code}.{ext}`; `.gitignore`/non-media counted as `straySkipped` and never copied; `--dry-run` writes nothing but still reports; idempotent re-run reports `copied: 0`, all `skipped`; verification report shows every per-size `match=OK`, `checksumMismatches: 0`, `strayInDest: 0` and exits `0`; missing/unreadable `--source` prints an error and exits `1`. Run and confirm it FAILS (command absent).

### Implementation for User Story 1

- [ ] T005 [P] [US1] Add a `MEDIA_SEED_SOURCE` placeholder (with an explanatory comment, defaulting to the prototype path `C:\projects\trash\storage\app\public\image\trash`) to `backend/.env.example`. It is a configurable path, not a secret.
- [ ] T006 [US1] Implement `backend/app/Console/Commands/SeedMediaCommand.php` (signature `media:seed [--source=PATH] [--dry-run]`) to pass T004 (depends on T003, T004, T005): resolve source from `--source` → `env('MEDIA_SEED_SOURCE')` → default prototype path (missing dir → error, exit 1); enumerate source recursively; classify each file via `MediaPath::isMediaFile` (non-media → `straySkipped`, never copied); map each media file to `image/trash/{size}/{shard}/{file}` using the source size dir + `MediaPath::shardFor`; copy via the `public` disk only when the destination is missing or its byte size differs (else `skipped`; nothing written under `--dry-run`); verify size + content hash per file (`checksumMismatches`) and scan the destination for non-media (`strayInDest`); print the verification report (per-size source/dest/match, copied, skipped, stray skipped, mismatches, stray-in-dest, RESULT); exit `0` only when every per-size count matches AND `checksumMismatches == 0` AND `strayInDest == 0`, else nonzero. `declare(strict_types=1)`, PSR-12, typed, functions < 30 lines, comments explain *why*.
- [ ] T007 [US1] Run the real seed against the prototype and validate quickstart steps 2–5: dry-run reports `stray skipped (source): 5` and writes nothing; real run copies into `backend/storage/app/public/image/trash/{size}/{shard}/…` with every size `match=OK`, `checksum mismatches: 0`, `stray files in destination: 0`, `RESULT: OK`, exit `0`; spot-check a known code under each size; re-run confirms `copied: 0`, all skipped (idempotent).

**Checkpoint**: US1 is fully functional — the existing library is seeded and verified. MVP complete.

---

## Phase 4: User Story 2 - A single, documented destination for future uploads (Priority: P2)

**Goal**: Establish and document the one canonical media location + folder convention so
future image and video uploads land alongside the seeded library, including the
`video/trash/{shard}/{code}.{ext}` convention (no size variants).

**Independent Test**: `MediaPath::videoRelativePath` yields `video/trash/{shard}/{code}.{ext}`
with the same shard rule as images; a developer can locate the documented destination for
new image and video uploads from project docs without inspecting the prototype.

### Tests for User Story 2

> Write first, ensure it FAILS before implementation.

- [ ] T008 [US2] Extend `backend/tests/Unit/Support/MediaPathTest.php` with failing tests for `videoRelativePath(code, ext)` → `video/trash/{shard}/{code}.{ext}`: no size segment, shard derived identically to images (incl. `other` for non-`[a-z0-9]` leads, e.g. `9zq-abc_de`→`9`). Run and confirm the new cases FAIL.

### Implementation for User Story 2

- [ ] T009 [US2] Add `videoRelativePath()` to `backend/app/Support/MediaPath.php` to pass T008 (depends on T008), reusing `shardFor()`; no size variants. Same conventions as T003.
- [ ] T010 [P] [US2] Document the canonical media location and convention so it is discoverable without the prototype (SC-005): in `backend/README.md` describe `image/trash/{size}/{shard}/{code}.{ext}` and `video/trash/{shard}/{code}.{ext}`, the shard rule, the `jpg,jpeg,png,gif` allowlist, and the git-exclusion of media payload, linking to `specs/003-media-storage/contracts/media-layout.md` as the authority.

**Checkpoint**: Both stories work independently — seeded images in place AND the upload destination/convention is documented and code-supported.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Lint, coverage gate, and full validation across the feature

- [ ] T011 [P] Run `vendor/bin/pint --test` from `backend/` and fix any style violations in `MediaPath.php` and `SeedMediaCommand.php`.
- [ ] T012 Run `php artisan test` from `backend/` and the coverage gate (`.github/scripts/check_coverage.py` against `coverage.clover`); confirm all tests pass and overall line coverage stays ≥ 90% with the new files covered.
- [ ] T013 Execute the full quickstart.md validation (steps 1–6), including the git-exclusion check (`git status --short backend/storage/app/public` shows no media; `git check-ignore` confirms the media path is ignored) — proves FR-010 / SC-006 end-to-end.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS both user stories** (provides `MediaPath`).
- **User Story 1 (Phase 3)**: Depends on Foundational. Independently testable/deliverable (MVP).
- **User Story 2 (Phase 4)**: Depends on Foundational. Independently testable; does not depend on US1.
- **Polish (Phase 5)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Needs `MediaPath` (T003). No dependency on US2.
- **US2 (P2)**: Needs `MediaPath` (T003); adds `videoRelativePath`. No dependency on US1 — can be built in parallel with US1 once Foundational is done.

### Within Each Story

- Tests are written before the implementation they cover and must FAIL first (T002→T003, T004→T006, T008→T009).
- US1: env placeholder (T005) and feature test (T004) before the command (T006); real-seed validation (T007) last.
- US2: unit test (T008) before `videoRelativePath` (T009); docs (T010) independent.

### Parallel Opportunities

- T001 (Setup) runs alone.
- Within US1: T004 (feature test) and T005 (.env.example) are different files → parallel.
- Within US2: T010 (docs) is independent of T008/T009 → parallel.
- Across stories: once Foundational (T003) is done, US1 and US2 can proceed in parallel (different files; US2's only shared file is the unit test, extended additively).
- Polish: T011 (lint) parallel with T013 prep; T012 after code is final.

---

## Parallel Example: User Story 1

```bash
# After Foundational (T003) is complete, launch the independent US1 starters together:
Task: "Write failing feature test in backend/tests/Feature/Console/SeedMediaCommandTest.php"
Task: "Add MEDIA_SEED_SOURCE placeholder to backend/.env.example"
# Then implement the command (T006) once both land.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001)
2. Phase 2: Foundational — `MediaPath` (T002–T003)
3. Phase 3: User Story 1 — `media:seed` (T004–T007)
4. **STOP and VALIDATE**: real seed produces a clean verification report (exit 0), idempotent re-run copies nothing.

### Incremental Delivery

1. Setup + Foundational → path logic ready.
2. US1 → seed + verify → the existing library is in place (MVP).
3. US2 → video path support + documented convention → upload feature can build on a documented destination.
4. Polish → lint, coverage gate, full quickstart validation.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- The 1.3 GB payload is never copied in tests — tests use `Storage::fake('public')` + small temp fixtures.
- No new Composer/npm dependencies (Principle I); no image library (copy bytes as-is).
- Media is never committed; only code, tests, `.env.example`, and docs are.
- Commit after each task or logical group.
