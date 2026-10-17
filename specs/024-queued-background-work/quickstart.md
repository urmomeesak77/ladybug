# Quickstart: validating Queued Background Work (024)

## Automated

```powershell
scripts\test-backend.ps1 --filter "ProcessPostMedia|FetchYoutubeThumbnail|SendRecoveryLink|Queued|CreatePost|Moderation|PasswordReset"
scripts\test-backend.ps1                       # full suite
cd frontend; npx vitest run --coverage         # PostPage processing/failed states, moderation badge
```

Key assertions (see contracts/ and data-model.md):
- `POST /api/posts` with an image → 201, `media_state: processing`, `Queue::assertPushed(ProcessPostMedia)`,
  no variant files written yet.
- Running `ProcessPostMedia` → variants identical to the pre-024 inline output; trusted uploader
  activated + credited once; running it a second time changes nothing.
- A corrupt staged file → post `failed`, no files for the hash, never activated.
- Purging before the job runs → job leaves no files and creates nothing.
- `POST /api/password/forgot` for a real and an unknown address → each pushes exactly one
  `SendRecoveryLink` and nothing else happens in-request.

## Manual (dev stack)

1. `docker compose up -d` — the `queue` service starts beside `backend`
   (`docker compose logs -f queue` shows `Processing: App\Jobs\ProcessPostMedia`).
2. Sign in as a trusted member, upload a large GIF; you land on the post page showing
   "Your upload is being processed…"; within seconds it turns into the post without reloading.
3. `docker compose stop queue`, upload again → the post stays processing and is absent from the
   feed in a private window. `docker compose start queue` → it completes.
4. Request a password reset with `MAIL_MAILER=log`; the request returns at once and the message
   appears in `storage/logs/laravel.log` after the worker picks it up.
5. Force a failure (`docker compose exec backend php artisan tinker` → mark a job's staged file
   unreadable) → post shows "We couldn't process this upload."; `php artisan queue:failed` lists
   nothing for media (handled), while a mail job with an unreachable SMTP host appears after its
   retries; `php artisan queue:retry all` re-runs it.

## SC-001 measurement (dev stack)

SC-001: while three maximum-size uploads are being processed, the home feed and a permalink
answer no more than 20% slower than with nothing processing.

1. `docker compose exec backend php artisan migrate:status` — the 024 migration must be `Ran`
   (tests use sqlite, so the dev DB can lag; back it up with `scriptsackup-db.ps1` first).
2. Baseline: time 20 requests each to `GET /api/posts` and `GET /api/posts/{hash}` (any public
   hash) with the queue idle — `curl -s -o NUL -w "%{time_total}
" http://localhost:8000/api/posts`
   — and keep the median.
3. Stage three maximum-size uploads at once (10 MiB, ~25 MP JPEGs) and, while
   `docker compose logs queue` still shows them running, repeat the same 20 + 20 requests.
4. Pass when each median is within 1.2x of its baseline. Purge the three test posts afterwards.

Dev serves the API with `php artisan serve`, not php-fpm, so this measures the property that
matters — media work no longer runs in the process answering requests — not production latency.

## Production

After deploy: `docker compose ps` shows `ladybug-queue` running; `docker compose exec ladybug-php
php artisan queue:failed` is empty; upload a meme and watch `docker compose logs -f ladybug-queue`.
