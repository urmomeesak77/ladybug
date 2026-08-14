# Contract: Configuration Surface

**Feature**: `023-access-log` | Covers FR-020 – FR-024, FR-032

This feature exposes no HTTP interface (FR-030). Its external contract is its **configuration**
— the settings an operator sets, their defaults, and what each one guarantees. Everything below
is read once at startup through `config/access_log.php`; changing a value takes effect on the
next restart, matching how every other environment setting in this project behaves.

---

## `config/access_log.php`

| Key | Env var | Default | Type | Requirement |
|---|---|---|---|---|
| `enabled` | `ACCESS_LOG_ENABLED` | `true` | bool | FR-020 |
| `excluded_paths` | `ACCESS_LOG_EXCLUDED_PATHS` | `api/health,up` | comma-separated list | FR-022 |
| `retention_days` | `ACCESS_LOG_RETENTION_DAYS` | `30` | int ≥ 1 | FR-023 |
| `value_limit` | `ACCESS_LOG_VALUE_LIMIT` | `65536` | int, bytes | FR-018 |
| `prune_enabled` | `ACCESS_LOG_PRUNE_ENABLED` | `true` | bool | FR-027a |
| `prune_cron` | `ACCESS_LOG_PRUNE_CRON` | `0 3 * * *` | cron expression | FR-027a |
| `sensitive` | — | see [redaction.md](./redaction.md) | string[] | FR-015 |
| `sensitive_prefixes` | — | `['remember_web_']` | string[] | FR-015 |

Plus one setting that lives with the database configuration because it is a connection
property, not a logging one:

| Key | Env var | Default | Requirement |
|---|---|---|---|
| `database.connections.mysql.options[PDO::ATTR_TIMEOUT]` | `DB_CONNECT_TIMEOUT` | `2` (seconds) | FR-025a |

---

## Guarantees per setting

### `ACCESS_LOG_ENABLED` — the switch (FR-020, FR-021, US3)

- **Absent from the environment entirely → recording is on.** The default lives in
  `config/access_log.php` as `env('ACCESS_LOG_ENABLED', true)`, so a fresh deployment records
  without anyone remembering to enable it (US3 scenario 1). Laravel's `env()` already casts the
  strings `"false"`/`"0"` to boolean `false`, so `ACCESS_LOG_ENABLED=false` does what it looks
  like it does.
- **Off means "write nothing", never "erase".** `RecordAccessLog` returns `$next($request)`
  unmodified and the service is never called. Rows already written stay (FR-021, US3 scenario 3).
- **Off means byte-identical responses.** The middleware is still in the stack but touches
  neither the request nor the response on either phase, so FR-021's "byte-for-byte what it
  would be with the feature absent" holds by construction, and SC-004 can assert it.

### `ACCESS_LOG_EXCLUDED_PATHS` — keeping the noise out (FR-022)

- Matched with `$request->is(...)`, so Laravel's `*` wildcards work (`admin/*`, `api/health`).
  Patterns are matched **without** a leading slash, as `$request->is()` expects.
- The default excludes both liveness probes this deployment polls continuously: `api/health`
  (the contractually database-free probe `deploy.sh`, `restore.sh` and CI all poll) and `up`
  (Laravel's own health route, wired in `bootstrap/app.php`). Without these two, container
  health checks would outnumber real traffic in the history by orders of magnitude — the exact
  edge case the spec calls out.
- No other path is excluded by default. In particular, authentication endpoints are **not**
  excluded: US2's whole point is that they are recorded *and* redacted, not omitted.

### `ACCESS_LOG_RETENTION_DAYS` — the window (FR-023)

- The cutoff is `now()->subDays(retention_days)`; rows with `created_at` strictly older are
  deleted. Both the scheduled run and a manual `--days` run use the same comparison, so
  FR-027b's "an automatic run deletes exactly what a manual run would" is structural.
- Values below 1 are clamped to 1, following the `max(1, …)` guard `config/remember.php`
  already applies to `REMEMBER_ME_LIFETIME`: a misconfigured `0` there would have expired every
  session instantly, and here it would delete the history it was meant to bound.

### `ACCESS_LOG_VALUE_LIMIT` — the per-value cap (FR-018, FR-018a, FR-018b)

- **Per value, not per entry.** Each query-parameter value, each form field, each cookie, and
  the raw body are capped independently. An entry has no ceiling.
- The operator-facing consequence, which belongs in any sizing conversation: worst-case entry
  size is *value count × limit*, not the limit. A request carrying many large values yields a
  large entry rather than a partially recorded one (FR-018b). Size storage against observed
  traffic.
- Raising it beyond 65536 is safe on the schema side — `body` is `longtext` and the JSON columns
  are MySQL `JSON` (max ~4 GB) precisely so the cap can move without a migration.

### `ACCESS_LOG_PRUNE_ENABLED` / `ACCESS_LOG_PRUNE_CRON` — the schedule (FR-027a)

See [prune-command.md](./prune-command.md) for the command, the schedule registration, and the
production service that drives it.

### `DB_CONNECT_TIMEOUT` — the write's bound (FR-025a)

- This is the number SC-006 measures against: "no request exceeds its normal completion time by
  more than the write's bound".
- It bounds **connect**, which covers the spec's case of a store that is down or unreachable:
  the connect fails within the timeout, `AccessLogService::record()` catches, `report()`s, and
  the response goes out normally (FR-025).
- It does **not** bound a store that accepts the connection and then stalls mid-statement — PDO's
  MySQL driver exposes no read timeout and MySQL's `max_execution_time` applies only to
  read-only `SELECT`s. Research D12 records why that residual risk is accepted rather than
  engineered around, and why the alternative (a second connection with its own timeout) costs
  more latency than it saves.
- It applies to the shared `mysql` connection, so it also gives the rest of the application a
  connect bound it does not have today. That is an improvement, but it is a change to existing
  behaviour and is listed in the plan's Complexity Tracking as such.

---

## Where the settings are documented (FR-024)

All three environment templates gain the block, because they describe three different
deployments and an operator reads only one of them:

| File | Purpose |
|---|---|
| `backend/.env.example` | dev defaults, copied into `backend/.env` on first container start |
| `deploy/backend.env.example` | production template, mounted read-only into `ladybug-php` |
| `docs/DEPLOYMENT.md` | the runbook — the scheduler service, the retention window, and the FR-018b sizing note |

Each block states the default inline, so an operator can see the effective value without
reading `config/access_log.php`.

---

## The scope boundary this configuration must state (FR-032)

The env documentation MUST carry this note, because an operator reading the history will
otherwise conclude that media traffic is *missing* rather than *out of scope*:

> The access log records requests handled by the **application** only. Requests answered
> directly by nginx — the SPA's static assets and everything under `/storage/` — never reach
> PHP and therefore never appear here. The history answers "who called the API for this meme";
> it does not answer "who fetched this image file". Ingesting nginx's own access log is a
> separate mechanism with different fields and is not part of this feature.

SC-010 tests this boundary empirically: a run that fetches 50 stored media files and the SPA's
assets must produce zero entries.

---

## Non-contract: what this feature does not expose

- **No route, no endpoint, no header, no response field.** FR-028 and FR-030 forbid it, and
  SC-009 probes for it. `routes/api.php` and `routes/web.php` are not edited by this feature.
- **No frontend file changes.** The SPA is untouched.
- **No new dependency.** Constitution Principle I; nothing is added to `composer.json` or
  `package.json`.
