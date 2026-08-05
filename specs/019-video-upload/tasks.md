# Tasks: Video Upload

**Input**: Design documents from `/specs/019-video-upload/`

**Prerequisites**: plan.md, spec.md, research.md (items 1–9), data-model.md,
contracts/api-posts.md, contracts/media-layout-video.md, quickstart.md

**Tests**: Included — Constitution Principle VII mandates ≥90% mirrored coverage
on both stacks, and the plan's Testing section commits to specific test files.
Write each story's tests first and watch them fail before implementing.

**Organization**: Tasks are grouped by user story so each story is independently
implementable and testable. Backend PHP runs through Docker (`php:8.3-cli`
image / `docker compose exec backend`) — there is no local PHP. Backend tests
run on SQLite `:memory:` only. After editing backend PHP against the running
dev stack, `docker compose restart backend` (opcache holds timestamps); after
editing the `docker/php/Dockerfile`, rebuild it (`docker compose build backend`)
so `ffmpeg` is actually present before running video tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)

## Path Conventions

Web app — `backend/` (Laravel 12 API) + `frontend/` (React 18 + Vite SPA), per
plan.md. Tests mirror source: `backend/tests/{Feature,Unit}/...` and
`frontend/tests/...` (the Vitest coverage gate spans ALL of `frontend/src/`).

---

## Phase 1: Setup (ffmpeg dependency & fixtures)

**Purpose**: Get the approved `ffmpeg`/`ffprobe` system dependency (research.md
item 2) installed everywhere it needs to run, and add the real video fixtures
every later test depends on.

- [x] T001 [P] Add `ffmpeg` to the apt-get install line in `docker/php/Dockerfile` (alongside the existing `gifsicle imagemagick`), with a comment noting it backs `ffprobe`-based video decode validation + poster extraction (research.md #2)
- [x] T002 [P] Add `ffmpeg` to the apt-get install line in `deploy/php/Dockerfile` (mirrors T001 for the production image)
- [x] T003 [P] Add an `ffmpeg` apt install step to `.github/workflows/ci.yml`'s backend job, next to the existing "Install gifsicle + imagemagick" step (~line 51-52)
- [x] T004 [P] Add real fixtures `backend/tests/fixtures/sample.mp4` and `backend/tests/fixtures/sample.webm` — small (a few seconds, well under 20 MB), valid, decodable video files, matching the existing `WebpFileTest.php` fixture convention (research.md #9)

**Checkpoint**: `docker compose build backend` succeeds with `ffmpeg`/`ffprobe` on `$PATH`; fixtures exist for every later test to reference.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The schema, model, and path/allowlist plumbing every user story's
video code depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Create migration `add_poster_to_trashposts_table` in `backend/database/migrations/`: adds a nullable `poster` string column to `trashposts`, positioned after `file` (data-model.md); no index (never queried on)
- [x] T006 [P] Add `'poster'` to `Trashpost::$fillable` in `backend/app/Models/Trashpost.php` (depends on T005)
- [x] T007 [P] Extend `backend/tests/Unit/Support/MediaPathTest.php`: `MediaPath::isVideoFile()` / video-extension coverage (`.mp4`/`.webm` → true, `.mov`/others → false) — must fail first
- [x] T008 [P] Add `VIDEO_EXTENSIONS = ['mp4', 'webm']` and `isVideoFile(string $filename): bool` to `backend/app/Support/MediaPath.php` (contracts/media-layout-video.md) — T007 goes green

**Checkpoint**: Schema, model, and path helpers are in place — user story implementation can now begin.

---

## Phase 3: User Story 1 - Upload a video as a new post (Priority: P1) 🎯 MVP

**Goal**: A verified member picks the new "Video" tab on `/upload`, submits a
valid MP4 or WebM under 20 MB with a title, and a new post is created — poster
extracted, playable, activated/pending per the existing trust rule (FR-001,
FR-003, FR-005, FR-006, FR-009, FR-010; contracts/api-posts.md 201 response;
contracts/media-layout-video.md).

**Independent Test**: As a verified member, open `/upload`, choose the Video
tab, select a valid video file under 20 MB, enter a title, submit. Confirm a
new post is created that plays the uploaded video back (quickstart Scenario 1).

### Tests for User Story 1 (write first — must fail)

- [x] T009 [P] [US1] Create `backend/tests/Unit/Support/FfmpegVideoTest.php`: `probe()` returns `{width, height, codec}` for `sample.mp4`/`sample.webm`, returns `null` for a non-video file; `extractPosterFrame()` writes a readable `.jpg` at the destination path for both fixtures
- [x] T010 [P] [US1] Create `backend/tests/Unit/Services/TrashpostVideoProcessorTest.php`: `process()` stores the video at `MediaPath::videoRelativePath()`, extracts+stores a poster at `image/trash/original/...` plus size variants (never wider than the source frame), and returns `{file, type: 'video', metadata (width/height/ratio from the video, mime from the upload), poster}`; `discard()` removes the video file and every poster variant it wrote
- [x] T011 [P] [US1] Extend `backend/tests/Unit/Services/MediaOwnershipServiceTest.php`: `ownedPaths()` for a `type === 'video'` post returns the single video file path plus every poster size variant (contracts/media-layout-video.md "Ownership") — closes the follow-up recorded in [[media-visibility-video-followup]]
- [x] T012 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: authenticated `.mp4` and `.webm` uploads (title + video field) each create a post with `type: 'video'`, a non-null `poster`, and `activated_at` set for a trusted uploader (`RatingService::TRUST_THRESHOLD`); below-threshold uploader's video post is created pending (`activated_at` null) — mirrors the existing image-upload assertions
- [x] T013 [P] [US1] Extend `frontend/tests/lib/feedModel.test.ts`: `RawPost.video`, `FeedMediaKind` gains `'video'`, and `FeedModel.deriveMedia()` returns a video variant (poster `src`/`srcset`/`sizes`/`alt`/`width`/`height` built the same way as an image post, plus `videoSrc` from `raw.video` and `mime` derived from its extension) when `raw.video` is present, checked before the YouTube/image branches (research.md #8)
- [x] T014 [P] [US1] Extend `frontend/tests/lib/uploadApi.test.ts`: `UploadApi.uploadVideo({title, file})` posts multipart with a `video` field and reuses the existing `send()`/`interpret()` outcomes (201 → hash, 422 → validation errors, 401/403/network)
- [x] T015 [P] [US1] Extend `frontend/tests/lib/uploadModel.test.ts`: `UploadMode` gains `'video'`; `UploadModel.validate()` requires a file when `mode === 'video'`; `UploadModel.submit()` dispatches `mode === 'video'` to `UploadApi.uploadVideo`
- [x] T016 [P] [US1] Extend `frontend/tests/components/MediaTabs.test.tsx`: a third "Video" tab renders, is selectable via click and via `useTabsKeyboard` arrow navigation, alongside the existing Image/YouTube tabs
- [x] T017 [P] [US1] Extend `frontend/tests/components/UploadMediaField.test.tsx`: `mode === 'video'` renders a labeled file input (`accept="video/mp4,video/webm"`) with `errors.video` associated the same way `errors.image` is today
- [x] T018 [P] [US1] Extend `frontend/tests/hooks/useUploadForm.test.tsx`: switching to/from the video tab drops the departed input's stale field error, extended to the three-way `image`/`youtube`/`video` set (currently a binary lookup)
- [x] T019 [P] [US1] Extend `frontend/tests/components/MemeMedia.test.tsx`: `media.kind === 'video'` renders a `<video>` element with a `poster` attribute and a `<source>` whose `src`/`type` come from `videoSrc`/`mime` (playback wiring only — autoplay-on-scroll behavior is US3)

### Backend implementation for User Story 1

- [x] T020 [US1] Create `backend/app/Support/FfmpegVideo.php`: a `Process`-facade wrapper mirroring `GifFile`'s argv-array pattern (never a shell string, Principle VI) — `probe(string $path): array{width:int, height:int, codec:string}|null` via `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of json`, `null` on a non-zero exit or unparseable output; `extractPosterFrame(string $srcPath, string $destPath): bool` via `ffmpeg -y -i {srcPath} -frames:v 1 {destPath}` — T009 goes green
- [x] T021 [US1] Create `backend/app/Http/Rules/ValidVideo.php` implementing `Illuminate\Contracts\Validation\ValidationRule`: calls `FfmpegVideo::probe()` on the uploaded file's real path and fails with a message distinct from the format/size messages (e.g. "The video file is unreadable or corrupt.") when it returns `null` (FR-004, Edge Cases, contracts/api-posts.md 422 table)
- [x] T022 [US1] Create `backend/app/Services/TrashpostVideoProcessor.php` mirroring `TrashpostImageProcessor`'s shape: constructor takes `TrashpostImageProcessor $images = new TrashpostImageProcessor()` (same default-constructor-injection pattern `TrashpostService` itself uses); `process(UploadedFile $file, string $hash): array{file, type, metadata, poster}` — derives the stored extension (`mp4`/`webm`) from the validated MIME (never the client filename, Principle VI), stores the video at `MediaPath::videoRelativePath()`, calls `FfmpegVideo::extractPosterFrame()` into the poster's `original` image path, runs it through the injected `TrashpostImageProcessor::generateMissingVariants()` for the size variants (research.md #4 — no duplicate variant logic), and builds `metadata` from `FfmpegVideo::probe()`'s width/height/ratio plus the video's own MIME (not the poster's); `discard(string $hash, UploadedFile $file): void` removes the video file and every poster variant on failure — T010 goes green (depends on T020)
- [x] T023 [US1] Edit `backend/app/Http/Requests/CreatePostRequest.php`: add a `video` rule (`required_without_all:image,youtube`, `mimetypes:video/mp4,video/webm`, `max:20480`, `new ValidVideo`), widen the existing `image`/`youtube` rules from `required_without:<other>` to `required_without_all:<the other two>`, and extend `validateExclusivity()` to a three-way check (any two/three of image/youtube/video present → the same per-field message pattern already used for image+youtube) (contracts/api-posts.md) — depends on T021
- [x] T024 [US1] Edit `backend/app/Services/TrashpostService.php`: constructor gains `TrashpostVideoProcessor $videos = new TrashpostVideoProcessor()`; `createPost()` gains a `?UploadedFile $video` parameter and, mirroring `attachImage()`, a new `attachVideo(Trashpost $post, UploadedFile $video)` private method that fills the post from `$this->videos->process()` and rolls back (discard + `forceDelete()`) on failure — depends on T022
- [x] T025 [US1] Edit `backend/app/Http/Controllers/TrashpostsApiController.php` `store()`: resolve `$request->file('video')` and pass it through to `TrashpostService::createPost()` alongside the existing image/youtube arguments — depends on T023, T024 — T012 goes green
- [x] T026 [US1] Edit `backend/app/Http/Resources/TrashpostResource.php`: add a `video` field — the post's public video file URL when `type === 'video'`, else `null` (contracts/api-posts.md 201 response) — depends on T025
- [x] T027 [US1] Edit `backend/app/Http/Resources/AdminTrashpostResource.php` `thumbnailUrl()`: branch `type === 'video'` to resolve from the `poster` column (via `MediaPath::imageRelativePath()`) instead of `file` (contracts/api-posts.md "GET /api/admin/posts") — depends on T026
- [x] T028 [US1] Edit `backend/app/Services/MediaOwnershipService.php` `ownedPaths()`: for `type === 'video'`, return `MediaPath::videoRelativePath()` for the video file plus every poster size variant (same loop already used for `file`, keyed on `poster`) — T011 goes green (depends on T008, T006)
- [x] T029 [US1] Create `backend/tests/Unit/Http/Rules/ValidVideoTest.php`: the rule passes for `sample.mp4`/`sample.webm` and fails with the distinct corrupt-content message for a non-video file (e.g. a renamed `.txt`) — must fail first, then T021 makes it pass (write and satisfy alongside T021)

### Frontend implementation for User Story 1

- [x] T030 [P] [US1] Edit `frontend/src/lib/feedModel.ts`: `RawPost` gains `video: string | null`; `FeedMediaKind` gains `'video'`; `FeedMedia`'s video variant carries the poster's `src`/`srcset`/`sizes`/`alt`/`width`/`height` (via the existing `pickImageSource()`/`buildSrcset()`) plus `videoSrc: string` and `mime: string`; `deriveMedia()` checks `raw.video` first (research.md #8) — T013 goes green
- [x] T031 [P] [US1] Add `UploadApi.uploadVideo(input: {title: string; file: File}): Promise<UploadResult>` in `frontend/src/lib/uploadApi.ts`, setting the multipart field name `video` and reusing `send()`/`interpret()` — T014 goes green
- [x] T032 [P] [US1] Edit `frontend/src/lib/uploadModel.ts`: `UploadMode` gains `'video'`; `validate()` requires a file for `mode === 'video'`; `submit()` dispatches `mode === 'video'` to `UploadApi.uploadVideo` — T015 goes green (depends on T031)
- [x] T033 [US1] Edit `frontend/src/components/MediaTabs.tsx`: add `{ id: 'video', label: 'Video' }` to the `TABS` array — T016 goes green
- [x] T034 [US1] Edit `frontend/src/components/UploadMediaField.tsx`: add a `mode === 'video'` branch rendering a labeled file input (`id="video"`, `accept="video/mp4,video/webm"`, `errors.video`) alongside the existing image-file branch — T017 goes green
- [x] T035 [US1] Edit `frontend/src/hooks/useUploadForm.ts`: generalize `changeMode()`'s departed-field error cleanup from the current binary `image`/`youtube` lookup to the three-way `image`/`youtube`/`video` set — T018 goes green
- [x] T036 [US1] Edit `frontend/src/components/MemeMedia.tsx`: add a `media.kind === 'video'` branch rendering a `<video poster={media.src} muted playsInline>` with a `<source src={media.videoSrc} type={media.mime}>` (playback wiring only; autoplay-on-scroll and the unmute/pause control are added in US3) — T019 goes green (depends on T030)
- [x] T037 [US1] Add `errors.video` styling parity to `frontend/src/styles/theme.css` if the existing `.auth-field__error` rule does not already cover the new field id (spot-check; likely no change needed since the class is shared)

**Checkpoint**: A video can be uploaded end-to-end and shows up on the feed/permalink with static poster + native browser controls — MVP.

---

## Phase 4: User Story 2 - Be stopped from uploading an unsupported or oversized video (Priority: P2)

**Goal**: A wrong-format, oversized, or corrupt video is rejected with a
specific, distinguishable message before any post is created (FR-002, FR-003,
FR-004, FR-007, SC-002).

**Independent Test**: Attempt to upload a file outside the supported formats,
and separately a supported-format file over 20 MB; confirm both are rejected
with distinct messages and no post is created (quickstart Scenario 2).

### Tests for User Story 2 (write first — must fail)

- [x] T038 [P] [US2] Add a "claims `.mp4` but isn't" fixture, `backend/tests/fixtures/fake-video.mp4` — a real MP4 header (`ftyp`/partial `moov`) truncated before any decodable stream data, so `finfo` sniffs `video/mp4` (passes `mimetypes`) but `ffprobe` finds no stream (isolates the `ValidVideo` corrupt-content check, distinct from a plain renamed-text file which would fail `mimetypes` on its own and never reach that check) — to `backend/tests/fixtures/` (research.md #9)
- [x] T039 [P] [US2] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: an unsupported-format video (e.g. `video/quicktime` MIME) → 422 naming MP4/WebM, no post row created; a valid-format file over 20 MB (`UploadedFile::fake()->create(...)`) → 422 stating the 20 MB limit, no post row created; `fake-video.mp4` → 422 with the distinct corrupt/unreadable message, no post row created; submitting both `image` and `video` together → 422 on the redundant field(s), no post row created
- [x] T040 [P] [US2] Extend `frontend/tests/e2e/upload.spec.ts`: a video-tab rejection (wrong format or oversized) shows an inline error naming the reason and does not navigate away from `/upload`; the title field the member already typed is still present after the rejection (FR-007)

### Implementation for User Story 2

- [x] T041 [US2] Verify/adjust the per-rule messages in `backend/app/Http/Requests/CreatePostRequest.php` (or a `messages()` override) so the `mimetypes` failure explicitly names "MP4, WebM" and the `max` failure explicitly states "20 MB", matching contracts/api-posts.md's 422 table — T039's format/size assertions go green (depends on T023 from US1)
- [x] T042 [US2] Confirm `ValidVideo::message()` in `backend/app/Http/Rules/ValidVideo.php` reads distinctly from the format/size messages (no wording overlap) — T039's corrupt-file assertion goes green (depends on T021 from US1)

**Checkpoint**: Every rejection path (format, size, corrupt content, multi-field) is enforced server-side with a distinct message and leaves no orphaned post row.

---

## Phase 5: User Story 3 - Watch video posts in the feed and on their own page (Priority: P3)

**Goal**: A video post autoplays muted inline once scrolled into view (feed) or
on load (permalink), pauses when scrolled out of view, shows its poster while
loading, and offers a visible unmute/pause control (FR-008, SC-004).

**Independent Test**: Scroll a video post into view in the feed — playback
starts muted automatically and pauses when scrolled back out; open the same
post's permalink directly — it also autoplays muted on load (quickstart
Scenario 3).

### Tests for User Story 3 (write first — must fail)

- [x] T043 [P] [US3] Create `frontend/tests/hooks/useVideoAutoplay.test.tsx`: the hook attaches an `IntersectionObserver` to the given video ref, calls `.play()` when intersecting past a mid-range threshold and `.pause()` when it isn't, and disconnects the observer on unmount (research.md #8, mirrors `Feed.tsx`'s sentinel-observer pattern but toggles repeatedly instead of firing once)
- [x] T044 [P] [US3] Extend `frontend/tests/components/MemeMedia.test.tsx`: the video branch starts `muted`; a rendered unmute control toggles `muted` without pausing; a rendered pause control toggles playback; both controls are keyboard-operable and labeled (Principle IV)
- [x] T045 [P] [US3] Extend `frontend/tests/e2e/upload.spec.ts` (or a new `frontend/tests/e2e/video-playback.spec.ts`): after uploading a video, scrolling it into view in the feed starts muted playback and scrolling it out pauses it; opening its permalink directly also autoplays muted on load; the poster is visible before playback starts (quickstart Scenario 3)

### Implementation for User Story 3

- [x] T046 [US3] Create `frontend/src/hooks/useVideoAutoplay.ts`: wraps an `IntersectionObserver` around a given `<video>` ref, calling `.play()`/`.pause()` as it crosses a mid-range visibility threshold (research.md #8) — T043 goes green
- [x] T047 [US3] Edit `frontend/src/components/MemeMedia.tsx`: wire the video branch to `useVideoAutoplay`; add a visible, accessible unmute/pause control (FR-008) that toggles `muted`/paused state independently of the autoplay-on-scroll behavior; poster stays the shown element until playback actually starts (Edge Cases: no layout jump) — T044 goes green (depends on T046, T036 from US1)
- [x] T048 [P] [US3] Add video-control styles (unmute/pause button, poster/video sizing) to `frontend/src/styles/theme.css` for both light and dark schemes, near the existing `.meme-media`/`.meme-media--video` rules (Principle IV)

**Checkpoint**: All three user stories are independently functional — video posts can be uploaded, are correctly rejected when invalid, and play back with autoplay-on-scroll everywhere other posts appear.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final parity checks spanning all three stories.

- [x] T049 [P] Extend `backend/tests/Unit/Services/RatingServiceTest.php` or `ModerationServiceTest.php` only if a video-typed post exposes a gap in the existing type-agnostic activate/deactivate/soft-delete/restore/purge assertions (FR-009, SC-005) — otherwise confirm (no code change) that the existing type-agnostic tests already cover a `type === 'video'` row via `TrashpostFactory` and skip — confirmed: `RatingService` never branches on `type` (fixed ±1 regardless), and `ModerationService::purge/delete/restore/deactivate/activate` delegate media resolution entirely to `MediaOwnershipService::ownedPaths()`, whose `type === 'video'` branch is already unit-tested by T011; no gap, no code change
- [x] T050 Run quickstart.md Scenarios 1–5 manually against the dev stack (`docker compose build backend && docker compose up`), including Scenario 1's upload-time comparison against an image upload (SC-001), Scenario 4's admin-console moderation parity walk, and Scenario 5's no-upscale check via `GET /api/posts/{hash}` — all 5 scenarios verified via the running dev stack (API-driven, real MP4/WebM fixtures, real ffmpeg poster extraction). Found and fixed two real gaps this surfaced: (1) the `add_poster_to_trashposts_table` migration had never been run against the dev MySQL (tests only ever touch SQLite `:memory:`, so this was invisible to the suite) — ran it; (2) `deploy/php/php.ini` and `docker/php/Dockerfile` had no PHP upload-size overrides, so PHP's stock 2M/8M (dev) and the pre-existing 10M/12M (prod, sized for the old 10 MiB image cap) would truncate any video anywhere near the new 20 MiB cap before Laravel's own `max:20480` rule could return its friendly, limit-naming message (SC-002) — added `docker/php/uploads.ini` and widened `deploy/php/php.ini` to 25M/26M (headroom above the 20 MiB app cap so the app-level message fires, not a generic PHP failure)
- [x] T051 Confirm the backend PHPUnit coverage run (`docker compose exec backend php artisan test --coverage`) and the frontend Vitest coverage run (`npm test -- --coverage`) both stay ≥90% with the new video files included — backend: 983 tests passed, 98.1% total line coverage (`FfmpegVideo` 95.5%, `TrashpostVideoProcessor` 95.0%, `ValidVideo` 100%); frontend: 895 tests passed across 92 files, 98.89% lines / 95.29% branches, confirmed via the exact CI gate script (`check_coverage.py frontend/coverage/clover.xml 90` → "coverage gate passed")

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T004's fixtures aren't required yet, but T001's `ffmpeg` install is needed before any video test runs) — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion
- **User Story 2 (Phase 4)**: Depends on Foundational completion; reuses the validation rules US1 builds (T021, T023) — implement after US1
- **User Story 3 (Phase 5)**: Depends on Foundational completion; reuses the `MemeMedia` video branch US1 builds (T036) — implement after US1
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories — the MVP
- **User Story 2 (P2)**: Builds on US1's `CreatePostRequest`/`ValidVideo` (T021, T023) rather than duplicating them, so implement after US1 even though its acceptance scenario is independently testable
- **User Story 3 (P3)**: Builds on US1's `MemeMedia` video branch (T036) rather than duplicating it, so implement after US1 even though its acceptance scenario is independently testable

### Within Each User Story

- Tests are written and confirmed failing before implementation
- Backend: Support (`FfmpegVideo`) → Rules (`ValidVideo`) → Requests (`CreatePostRequest`) → Services (`TrashpostVideoProcessor`, `TrashpostService`, `MediaOwnershipService`) → Controllers → Resources
- Frontend: `lib/` (pure model/data-shaping) → `hooks/` → `components/`
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks (T001–T004) can run in parallel
- Foundational tests/tasks marked [P] (T007) can run in parallel with T006 once T005 lands
- Within US1, all test tasks (T009–T019) marked [P] can run in parallel; within backend implementation, T020/T021 are sequential (Rule depends on the Support wrapper) but T026–T028 can proceed in parallel once T025 lands; within frontend implementation, T030–T032 (`lib/`) can run in parallel
- US2 and US3 cannot start meaningfully until US1's shared building blocks (T021/T023, T036) exist, but their own test-writing (T038–T040, T043–T045) can be drafted in parallel with US1's later tasks

---

## Parallel Example: User Story 1

```bash
# Launch all backend tests for User Story 1 together:
Task: "Create backend/tests/Unit/Support/FfmpegVideoTest.php"
Task: "Create backend/tests/Unit/Services/TrashpostVideoProcessorTest.php"
Task: "Extend backend/tests/Unit/Services/MediaOwnershipServiceTest.php"
Task: "Extend backend/tests/Feature/Http/Controllers/CreatePostTest.php"

# Launch all frontend lib tests for User Story 1 together:
Task: "Extend frontend/tests/lib/feedModel.test.ts"
Task: "Extend frontend/tests/lib/uploadApi.test.ts"
Task: "Extend frontend/tests/lib/uploadModel.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (ffmpeg installed, fixtures added)
2. Complete Phase 2: Foundational (migration, model, `MediaPath` helpers)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Upload a real `.mp4`/`.webm`, confirm the post is created and playable (quickstart Scenario 1)
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add User Story 1 → validate independently → MVP
3. Add User Story 2 → validate rejections independently
4. Add User Story 3 → validate autoplay-on-scroll independently
5. Polish → full quickstart pass + coverage gate

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
