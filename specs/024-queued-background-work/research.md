# Research: Queued Background Work (024)

Each entry: **Decision** / **Rationale** / **Alternatives considered**.

## D1 — Queue backend

- **Decision**: Laravel's `database` queue driver on the existing MySQL. The `jobs`, `job_batches`
  and `failed_jobs` tables already exist (`0001_01_01_000002_create_jobs_table.php`); production
  flips `QUEUE_CONNECTION` from `sync` to `database`. `retry_after` is raised to 210 s so it always
  exceeds the longest job timeout (D3) — otherwise a long job is handed to a second attempt while the
  first is still running.
- **Rationale**: zero new services or packages (Principle I); durable across restarts (FR-024);
  `failed_jobs` + `queue:retry` / `queue:forget` give the operator retention and recovery (FR-021)
  with no new screen.
- **Alternatives**: Redis (new service + memory on a 960 MiB box); `dispatch()->afterResponse()`
  (still occupies the php-fpm worker after the response — the starvation this feature removes —
  and is not durable).

## D2 — Worker process

- **Decision**: a `ladybug-queue` service in `deploy/docker-compose.prod.yml` on the same php image,
  running `php artisan queue:work database --sleep=3 --tries=1 --timeout=180 --max-jobs=200
  --max-time=3600 --memory=256`, `restart: unless-stopped`, `mem_limit: 384m`,
  `stop_grace_period: 200s` (so a deploy lets the in-flight job finish). Per-job `$tries` /
  `$backoff` / `$timeout` on the job classes override the CLI defaults. Dev compose gets an
  equivalent `queue` service. The e2e stack stays on `sync` (deterministic specs; the async path is
  covered by PHPUnit job tests).
- **Rationale**: FR-022/FR-023. `--max-jobs`/`--max-time` recycle the process; `--memory` makes it
  exit cleanly when its own heap grows; `mem_limit` is the hard ceiling. Recreated by deploy's
  `up -d` with the new image (FR-025); queued rows survive in MySQL.
- **Memory budget**: media decoding moves OUT of php-fpm, so php-fpm's worst case drops (no GD
  bitmaps in request workers); the queue worker inherits it. The 25 MP pixel cap (MaxPixels) bounds
  one decode at ~100 MB + scaled copy ≈ 180 MB < 256 MB `memory_limit`; ImageMagick/ffmpeg children
  are bounded by the ImageMagick policy and per-call timeouts, and the container's 384m ceiling.
  `ladybug-php` is lowered 550m → 450m to keep the sum within the box (documented in compose).

## D3 — Killing a hung job and its child tools

- **Decision**: two layers. (1) Every external tool call (`ffprobe`, `ffmpeg`, `gifsicle`,
  `convert`) gets an explicit Symfony Process timeout (probe 30 s, others 90 s); Process kills the
  child on expiry and throws, which the job turns into a *failed* post. (2) The worker's job
  `--timeout` (enforced via `pcntl` alarm) is the backstop for PHP-side hangs. `pcntl` is a bundled
  PHP extension added to both Dockerfiles with `docker-php-ext-install pcntl` — not a Composer/npm
  dependency.
- **Rationale**: the job timeout alone SIGKILLs the PHP worker but can orphan an `ffmpeg` child;
  the per-call timeout is what actually stops the tool.
- **Alternatives**: `timeout(1)` wrappers in argv (shell-level, less portable; Process already does
  it).

## D4 — Processing state on the post

- **Decision**: a non-null `media_state` string column on `trashposts` (`processing` | `ready` |
  `failed`), default `ready` (so every existing row is *ready* with no backfill), plus a nullable
  `media_source` holding the staged upload's path on the private `local` disk while processing.
  `scopePubliclyVisible` gains `media_state = 'ready'` (FR-006), so the feed, sitemap, OG preview,
  shell metadata and permalink all inherit it through the single existing definition.
- **Rationale**: one rule, one place — the existing scope is already the single definition of
  "public". A string enum reads clearly in SQL and in the API.
- **Alternatives**: deriving state from "file is null" (cannot express *failed*); a separate jobs
  status table (joins on every feed query).

## D5 — The media job

- **Decision**: `App\Jobs\ProcessPostMedia` (hash, bool autoActivate), `$tries = 2`, `$timeout =
  180`. `handle()`:
  1. Load the row `withTrashed()`. Missing (purged) → delete the staged source, return (FR-017).
  2. `media_state !== processing` → return (already done; FR-016).
  3. Discard any files a previous interrupted attempt wrote for this hash, then run the EXISTING
     `TrashpostImageProcessor::process` / `TrashpostVideoProcessor::process` against the staged
     file (FR-014: identical output, same code).
  4. One transaction, row locked: re-check the row still exists and is still *processing*; fill
     media fields, `media_state = ready`, clear `media_source`; if `autoActivate` and not trashed →
     `activated_at = now()` + `RatingService::credit` (FR-007). Then forget page metadata.
  5. Delete the staged source.
  - On a processing exception: discard written files, mark *failed*, delete the source, report it —
    no rethrow, so it is not retried (a file that cannot be processed will not process on retry,
    FR-020). `failed()` (worker killed twice / timeout) does the same cleanup.
- **autoActivate** is decided in the request from the uploader's standing at upload time (exactly
  as today, FR-020 of 011) and travels in the job payload — no column.
- **Alternatives**: deciding trust in the job (would let the upload's own later credit change the
  outcome; violates 011 FR-020).

## D6 — YouTube posts

- **Decision**: a YouTube post is created *ready* (nothing to process) with the existing
  activation rule applied in the request (it is cheap); its still is fetched by
  `App\Jobs\FetchYoutubeThumbnail` (`$tries = 3`, backoff 30/120 s) calling the existing
  `YoutubeThumbnailService::ensure`. Best-effort: a final failure leaves the post without a still,
  as today (FR-018).

## D7 — Mail

- **Decision**: queued notification subclasses `App\Notifications\QueuedVerifyEmail` (extends
  `VerifyEmail`) and `App\Notifications\QueuedResetPassword` (extends `ResetPassword`), both
  `ShouldQueue` with `$tries = 5`, `$backoff = [10, 60, 300, 900]` and `$deleteWhenMissingModels =
  true` (no send to a deleted account, FR-019). `User` overrides `sendEmailVerificationNotification`
  and `sendPasswordResetNotification`. The existing `createUrlUsing` link builders are static and
  registered at boot, so the worker builds byte-identical links.
- **Timing oracle (FR-004)**: queueing the *send* is not enough — `Password::sendResetLink` still
  bcrypt-hashes and stores a token for a real account inside the request. So the WHOLE recovery
  decision moves into `App\Jobs\SendRecoveryLink(email)`, dispatched for EVERY request: the request
  path does one identical insert regardless of the address. The job calls the existing
  `PasswordService::sendRecoveryLink` logic.
- **Link lifetimes**: the verification link is signed when the job builds the message (expiry from
  send ≥ from request); the recovery token row is created by the job, so its 60-minute window
  starts when the message is built. Both are at least as long as today (spec US4 AS4).

## D8 — Uploader-facing state

- **Decision**: `TrashpostResource` gains `media_state`. `PostPage` renders a `PostProcessing`
  status block (`role="status"`, text + aria-hidden spinner) while *processing*, re-fetching the
  post every 2 s (paused while the tab is hidden, stopped on unmount) — FR-011's 5 s bound; and a
  `role="alert"` failed block with a link to `/upload` when *failed*. The moderation console shows
  a text badge "Processing"/"Processing failed" and omits Activate unless *ready*;
  `ModerationService::activate` refuses a non-ready post with 409 (FR-008).
- **Alternatives**: SSE/WebSocket push (new infrastructure; polling a cheap indexed GET every 2 s
  only while one person watches is negligible).

## D9 — Staging the upload

- **Decision**: the request stores the validated file on the private `local` disk at
  `staging/{hash}.{ext}` (ext from MIME, as today) before dispatching. A write failure (disk full)
  rolls back the reserved row and answers 503 "Uploads are temporarily unavailable" (edge case).
- **Rationale**: PHP deletes its own temp upload at request end, so the worker needs a durable copy;
  the private disk is never web-served.
