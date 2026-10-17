# Tasks: Queued Background Work

**Input**: Design documents from `/specs/024-queued-background-work/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — the project is TDD and Constitution VII demands ≥90% coverage. Every test task
is written first and must fail before its implementation task.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Enable the bundled `pcntl` extension in `deploy/php/Dockerfile` and `docker/php/Dockerfile` (`docker-php-ext-install … pcntl`) so `queue:work --timeout` can stop a hung job (research D3)
- [X] T002 [P] Set `QUEUE_CONNECTION=database` and `DB_QUEUE_RETRY_AFTER=210` in `deploy/backend.env.example` with a comment on why retry_after exceeds the 180 s job timeout (research D1)

## Phase 2: Foundational

- [X] T003 Write `backend/tests/Feature/Database/MediaStateMigrationTest.php`: columns exist, existing rows read `ready`, `media_source` nullable
- [X] T004 Create `backend/database/migrations/2026_10_14_000000_add_media_state_to_trashposts_table.php` (`media_state` string(16) default `ready`, `media_source` nullable string) per data-model.md
- [X] T005 Write failing tests in `backend/tests/Unit/Models/TrashpostTest.php` (or the existing visibility tests) that `publiclyVisible()` excludes `processing` and `failed` rows even when activated
- [X] T006 Add `media_state = 'ready'` to `Trashpost::scopePubliclyVisible` in `backend/app/Models/Trashpost.php` and add `Trashpost::MEDIA_PROCESSING/READY/FAILED` constants
- [X] T007 Write failing tests in `backend/tests/Unit/Support/FfmpegVideoTest.php`, `GifFileTest.php`, `WebpFileTest.php` that each Process is created with an explicit timeout (probe 30 s, others 90 s) — proven behaviourally where practical (a command that outlives a short timeout is killed and reported as a failure) — analyze I1
- [X] T008 Give every Process in `backend/app/Support/FfmpegVideo.php`, `GifFile.php`, `WebpFile.php` an explicit `setTimeout()`; a `ProcessTimedOutException` surfaces as the method's existing failure result/exception (research D3)

**Checkpoint**: schema + visibility rule + bounded tools in place.

## Phase 3: User Story 1+2+3 — Uploads processed in the background, never public early (P1) 🎯 MVP

US1 (responsiveness), US2 (uploader states) and US3 (never public early) share one mechanism and are
delivered together; each keeps its own independent test.

### Tests (write first, must fail)

- [X] T009 [P] [US1] `backend/tests/Feature/Http/Controllers/CreatePostTest.php`: an image/video upload answers 201 with `media_state: processing`, pushes `ProcessPostMedia` (Queue::fake), writes NO variant files, stages the file on the `local` disk; YouTube answers `ready` and pushes `FetchYoutubeThumbnail`; staging failure → 503 and no row
- [X] T010 [P] [US3] `backend/tests/Unit/Jobs/ProcessPostMediaTest.php`: success → variants identical to the inline processor's, `ready`, source deleted; trusted (`autoActivate`) → activated + credited once; untrusted → stays pending; second run is a no-op; corrupt file → `failed`, no files, not activated, not rethrown; purged row → no files, nothing created; trashed row → processed but not activated; `failed()` cleans up like a processing failure
- [X] T011 [P] [US3] `backend/tests/Unit/Jobs/FetchYoutubeThumbnailTest.php`: calls the existing thumbnail service; missing post → no-op; tries/backoff declared
- [X] T012 [P] [US2] `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`: `media_state` in show/feed; owner and admin get 200 for processing/failed, guest and other member 404; feed never lists processing/failed
- [X] T013 [P] [US3] `backend/tests/Unit/Services/ModerationServiceTest.php` + `tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php`: activate on non-ready → 409, no rating change; purge of a processing post deletes its staged source; admin index rows carry `media_state`
- [X] T014 [P] [US3] Sitemap/OG/shell tests assert a processing post is absent from `SitemapService`, `/og/{hash}.jpg` (404) and the shell body (existing test files)

### Implementation

- [X] T015 [US1] Create `backend/app/Jobs/ProcessPostMedia.php` per research D5 (hash + autoActivate; tries 2, timeout 180; idempotent; locked transaction for ready+activate+credit; cleanup on failure; `failed()`)
- [X] T016 [P] [US1] Create `backend/app/Jobs/FetchYoutubeThumbnail.php` (tries 3, backoff [30,120], timeout 30) wrapping `YoutubeThumbnailService::ensure`
- [X] T017 [US1] Rework `TrashpostService::createPost` in `backend/app/Services/TrashpostService.php`: reserve row as before; image/video → set `media_state=processing`, stage the file to `local:staging/{hash}.{ext}` (503 on failure via a dedicated exception rendered by the controller), dispatch `ProcessPostMedia(hash, autoActivate)`; YouTube → `ready`, activate as today, dispatch `FetchYoutubeThumbnail`. Keep `TrashpostImageProcessor`/`TrashpostVideoProcessor` untouched; expose a `processStaged()`-style entry they already support (process an UploadedFile built from the staged path)
- [X] T018 [US1] Map the staging exception to 503 with the contract message in `backend/app/Http/Controllers/TrashpostsApiController.php`
- [X] T019 [US2] Add `media_state` to `backend/app/Http/Resources/TrashpostResource.php` and `AdminTrashpostResource.php`; never serialize `media_source`
- [X] T020 [US3] `ModerationService::activate` refuses non-ready with a 409 (`backend/app/Services/ModerationService.php` + controller mapping); `purge` deletes `media_source` from the `local` disk
- [X] T021 [US1] Add a `queue` service to `docker-compose.yml` (dev) running `php artisan queue:work database --sleep=3 --tries=1 --timeout=180 --max-jobs=200 --max-time=3600 --memory=256`, same image/volumes as `backend`
- [X] T022 [US1] Add `ladybug-queue` to `deploy/docker-compose.prod.yml` (same command, `restart: unless-stopped`, `mem_limit: 384m`, `stop_grace_period: 200s`, backend.env, storage bind mount) and rebalance the memory comment/limits (`ladybug-php` 550m → 450m) per research D2; set `php_admin_value[memory_limit] = 128M` in `deploy/php/www.conf` (request workers no longer decode media; the CLI worker keeps php.ini's 256M) — analyze C1

### Frontend (US2/US3)

- [X] T023 [P] [US2] Tests `frontend/tests/components/PostProcessing.test.tsx`: processing → `role="status"` text, spinner aria-hidden; failed → `role="alert"` with "Upload it again" link to `/upload`
- [X] T024 [P] [US2] Tests in `frontend/tests/hooks/usePost.test.tsx`: re-fetches every 2 s while `processing`, stops on ready/failed/unmount, pauses while `document.hidden`
- [X] T025 [P] [US2] Tests in `frontend/tests/pages/PostPage.test.tsx`: renders processing → swaps to the finished post in place when the refetch returns ready; renders failed state
- [X] T026 [P] [US3] Tests for the moderation console: "Processing"/"Processing failed" text badge, Activate absent unless ready (existing moderation component tests)
- [X] T027 [US2] Add `mediaState` to the post model types in `frontend/src/lib/feedModel.ts` (and the post/admin models that parse the API) defaulting to `ready`
- [X] T028 [US2] Create `frontend/src/components/PostProcessing.tsx` per contracts/ui-processing-state.md (+ styles in `frontend/src/styles/theme.css`, reduced-motion safe)
- [X] T029 [US2] Re-fetch while processing in `frontend/src/hooks/usePost.ts`; render by state in `frontend/src/pages/PostPage.tsx`
- [X] T030 [US3] Badge + Activate gating in `frontend/src/components/moderation/*`

**Checkpoint**: uploads no longer process in-request; processing/failed states work end to end.

## Phase 4: User Story 4 — Mail off the request path, no timing oracle (P2)

- [X] T031 [P] [US4] Tests `backend/tests/Unit/Notifications/QueuedVerifyEmailTest.php` + `QueuedResetPasswordTest.php`: implement ShouldQueue, tries/backoff, deleteWhenMissingModels, build the same link as today
- [X] T032 [P] [US4] Tests `backend/tests/Unit/Jobs/SendRecoveryLinkTest.php`: real enabled account → reset notification queued; unknown/disabled → nothing; behaviour identical to the old `PasswordService::sendRecoveryLink`
- [X] T033 [P] [US4] Feature tests: `POST /api/password/forgot` pushes exactly one `SendRecoveryLink` for a real AND an unknown address and does no other DB write; register/resend queue `QueuedVerifyEmail` (existing controller test files)
- [X] T034 [US4] Create `backend/app/Notifications/QueuedVerifyEmail.php` and `QueuedResetPassword.php`
- [X] T035 [US4] Override `sendEmailVerificationNotification()` / `sendPasswordResetNotification()` in `backend/app/Models/User.php`
- [X] T036 [US4] Create `backend/app/Jobs/SendRecoveryLink.php`; `PasswordService`'s request entry point dispatches it for every address, the job runs the existing lookup + broker logic (`backend/app/Services/PasswordService.php`, `PasswordResetController.php`)

## Phase 5: User Story 5 — Operator visibility (P3)

- [ ] T037 [US5] Document the worker, `queue:failed` / `queue:retry` / `queue:forget`, the stuck-processing check and the memory budget in `docs/DEPLOYMENT.md`; make `deploy/deploy.sh`'s health summary print `queue:failed` count and confirm `ladybug-queue` is running
- [ ] T038 [US5] Test (`backend/tests/Unit/Jobs/*`) that permanently failing mail/thumbnail jobs end in `failed_jobs` (tries exhausted) while a media processing failure is handled (post `failed`) and not left in `failed_jobs` twice

## Phase 6: Polish

- [ ] T039 Keep `.env.e2e` on `sync` and confirm the Playwright upload specs still pass against it (document why in the e2e env comment)
- [ ] T040 Update `CLAUDE.md` Current State with a 024 entry
- [ ] T041 Add a SC-001 measurement step to `quickstart.md` (time home/permalink loads on the dev stack while three max-size uploads process) and run it once — analyze E1
- [ ] T042 Run Pint, PHPUnit + coverage gate, ESLint, tsc, Vitest + coverage; fix anything red

## Dependencies

- Phase 1 → Phase 2 → Phase 3 (MVP). Phase 4 depends only on Phase 2 (independent of Phase 3).
  Phase 5 after 3 and 4. Polish last.
- Within Phase 3: T009–T014 before T015–T022; T023–T026 before T027–T030; T015 before T017.

## Parallel Examples

- Phase 3 tests T009–T014 and T023–T026 touch different files → all [P].
- Phase 4 can proceed in parallel with Phase 3's frontend half.

## Implementation Strategy

MVP = Phases 1–3: the outage (US1) and its safety rails (US2, US3) ship together, because moving
processing off-request without the processing state or the visibility guard would publish broken
posts. Then US4 (mail + timing oracle), then US5 (operator docs/checks).
