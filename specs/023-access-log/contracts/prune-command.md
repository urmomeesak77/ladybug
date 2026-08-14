# Contract: `access-log:prune` and its Schedule

**Feature**: `023-access-log` | Covers FR-027, FR-027a, FR-027b, FR-027c, US4, SC-007

One routine, two ways to start it. Both call `AccessLogService::prune()`, so there is no second
deletion rule that could drift from the first (FR-027b).

---

## Command

```
php artisan access-log:prune [--days=N]
```

| Aspect | Contract |
|---|---|
| **Signature** | `access-log:prune {--days= : Override the configured retention window}` |
| **Default window** | `config('access_log.retention_days')` — 30 days (FR-023) |
| **Cutoff** | `now()->subDays($days)`; rows with `created_at` **strictly older** are deleted |
| **Output** | `Deleted N access log entries older than D days.` |
| **Exit code** | `0` on success, including when nothing was deleted; non-zero only on an actual failure |
| **Idempotent** | Yes. A second run immediately after a first deletes 0 rows and still reports success (SC-007) |
| **Safe under traffic** | Yes — see chunking below (FR-027) |
| **Concurrency** | Two simultaneous runs are safe: each chunk's `DELETE … LIMIT` simply finds fewer rows. There is no lock and no lease |

In this project there is no local PHP, so an operator runs it through the container:

```
docker compose exec backend php artisan access-log:prune
docker compose exec backend php artisan access-log:prune --days=7
```

---

## Deletion strategy: chunked, resumable

`AccessLogService::prune(int $days): int` deletes in passes of **1000 rows**, looping until a
pass deletes nothing, and returns the total.

Why chunks rather than one statement:

- **FR-027's "safe to run while the site is serving traffic".** A single `DELETE` over a month
  of a busy history holds row locks and grows the undo log for the whole of its run; 1000-row
  passes commit continuously and leave gaps for concurrent inserts. US4 scenario 5 requires
  requests to be served *and recorded* normally throughout the run.
- **FR-027c's "an interrupted run leaves the history in a state where the next run completes
  the work".** Each pass commits on its own, so a killed run has simply done less. There is no
  half-state to repair, no cursor to persist, and no partial row.
- A failed pass propagates as a normal command failure. It cannot affect request handling or
  recording, because nothing on the request path shares state with it.

The cutoff is recomputed once per invocation, not per chunk, so a long run has a stable
boundary and cannot chase `now()` forward into rows it was never meant to delete.

---

## Schedule registration (FR-027a)

Registered in `backend/routes/console.php` — Laravel 12 has no `Kernel::schedule()`, and this
project's `routes/console.php` currently holds only the stock `inspire` command:

```php
if (config('access_log.prune_enabled')) {
    Schedule::command('access-log:prune')
        ->cron(config('access_log.prune_cron'))
        ->withoutOverlapping();
}
```

| Aspect | Contract |
|---|---|
| **Enabled by default** | Yes — `ACCESS_LOG_PRUNE_ENABLED` defaults to `true` (FR-027a) |
| **Default cadence** | `0 3 * * *` — daily at 03:00 UTC |
| **Configurable** | Yes — any cron expression via `ACCESS_LOG_PRUNE_CRON` (FR-027a) |
| **Overlap** | `withoutOverlapping()` — a run that outlives its window is not joined by the next one |
| **Equivalence** | A scheduled run deletes exactly what a manual run with the same window deletes; it is the same method (FR-027b, SC-007) |

03:00 rather than midnight: it keeps the daily delete away from the backup window documented in
`docs/DEPLOYMENT.md` §6, so the two do not contend for the same 1 vCPU.

---

## What actually drives the schedule (the part that would otherwise be dead code)

A registration is inert unless something calls `schedule:run` every minute, and **nothing in
this deployment does today**: `ladybug-php` runs php-fpm as PID 1, and production sets
`QUEUE_CONNECTION=sync` with an explicit comment that there is no worker process. FR-027a rules
out solving this with a host crontab ("without host-level scheduling being configured
separately"), so the stack gains a service of its own:

```yaml
  ladybug-scheduler:
    image: ghcr.io/urmomeesak77/ladybug-php:${LADYBUG_TAG:-latest}
    restart: unless-stopped
    command: ["php", "artisan", "schedule:work"]
    volumes:
      - ./backend.env:/var/www/html/.env:ro
      - ./data/storage:/var/www/html/storage
    depends_on:
      ladybug-mysql:
        condition: service_healthy
```

Notes that make this acceptable on a 1 vCPU / 960 MiB box:

- **No new dependency and no new image.** It is the existing `ladybug-php` image with a
  different command — the same pin, the same `LADYBUG_TAG`, deployed by the same `deploy.sh`.
- **Idle cost is small**: `schedule:work` sleeps and forks `schedule:run` once a minute; on
  every minute but one per day that run exits immediately having matched nothing.
- **Not attached to the `edge` network.** Like `ladybug-php` and `ladybug-mysql`, it stays on
  `default` and is unreachable from outside the stack.
- **Same env mount**, so it sees the same retention window and the same database credentials as
  the application. A scheduler configured differently from the app it prunes for would be a
  quiet way to delete the wrong rows.

**Dev and e2e** get no scheduler service. Locally the command is run by hand, which is what an
operator does anyway while developing; `docker-compose.yml` says in its header that it is a
development-only stack and CI does not depend on it.

---

## Verification (US4 Independent Test, SC-007)

1. Seed entries dated on both sides of the window.
2. Run the routine; assert 100% of the older entries are gone and 100% of the newer ones remain.
3. Run it again; assert nothing changes and the exit code is still 0.
4. Change `ACCESS_LOG_RETENTION_DAYS`, run again, assert the new window is honoured without a
   code change (US4 scenario 3).
5. Assert the schedule is registered on a deployment where nobody configured it — inspect
   `php artisan schedule:list` and confirm the entry and its cron expression are present
   (US4 scenario 4, SC-007's "the schedule fires on a deployment where nobody configured it").
6. Assert requests are served and recorded normally while a run against a large history is in
   flight (US4 scenario 5).

Steps 1–5 are automated in `tests/Feature/Console/Commands/AccessLogPruneCommandTest.php`.
[quickstart.md](../quickstart.md) covers the manual half.
