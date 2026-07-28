# Production deployment to online-trash.com — design

**Date:** 2026-07-28
**Status:** proposed
**Scope:** infrastructure and release tooling. One behavioural code change
(`bootstrap/app.php` trusted proxies); no feature change, no schema change, no new
Composer or npm dependency.

## Problem

Ladybug runs only on the developer's Windows box, under a dev-only stack that
`docker-compose.yml` itself disclaims ("This is NOT a production setup"). The
`online-trash.com` domain currently serves a 17-byte placeholder. There is no
production image, no release pipeline, no deployment procedure, and no off-box
backup of the meme library.

## Goal

Serve the site at `https://online-trash.com` from the existing Zone.eu virtual
server, alongside the Thousand game that already runs there, with:

1. A reproducible release: CI builds images, the server only pulls.
2. The existing DB and 1.3 GB media library carried over intact.
3. Production-safe configuration (no debug, non-root DB user, secure cookies).
4. Off-box backups that survive a full VPS reset, and a rehearsed restore.

## Current state (surveyed 2026-07-28)

### The server

`online-trash.com` → `217.146.72.141` → `uvn-72-141.tll01.zonevs.eu`, a Zone.eu
virtual server. Ubuntu 24.04.4, Docker 29.5.2, Compose v5.1.4.

| Resource | Value |
| --- | --- |
| vCPU | 1 |
| RAM | 960 MiB, **no swap** |
| Disk | single 20 GiB virtio disk, 15 GiB free |

Disk layout is a single `/dev/vda` with no LVM and no detachable volume:

```
vda      20G
├─vda14   4M  BIOS boot   ┐ all three sit at the START of the disk
├─vda15 106M  /boot/efi   │
├─vda16 913M  /boot       ┘
└─vda1   19G  /           ← LAST partition, runs to the end of the disk
```

### What already runs there

- `nginx-web-1` — `nginx:latest` from `/web/nginx/docker-compose.yml`, ports 80/443.
  Mounts `/web/online-trash.com/public` → `/usr/share/nginx/html`,
  `/web/games.online-trash.com/public` → `/usr/share/nginx/games`, plus the certbot
  webroot and cert store. Already declares
  `extra_hosts: host.docker.internal:host-gateway`.
- `thousand` — `ghcr.io/urmomeesak77/thousand:latest`, `docker run` by hand,
  `unless-stopped`, published on `:3000`, reverse-proxied by the edge at
  `games.online-trash.com/thousand/`. This is the precedent the Ladybug stack follows.
- `nginx-certbot-1` — **`Exited (1)` for 7 weeks**.

### TLS

One ECDSA cert covers `online-trash.com`, `www.online-trash.com` and
`games.online-trash.com`, issued 2026-06-04, **expiring 2026-09-02**. The renewal
config uses the webroot authenticator with all three domains mapped to
`/var/www/certbot`. Renewal is currently broken twice over: the certbot container
is dead and root has no crontab. Additionally the apex `:80` server block redirects
to HTTPS **without** an ACME challenge exception (the games block has one).

### Application facts that shape the design

| Fact | Source | Consequence |
| --- | --- | --- |
| API base URL falls back to `''` | `frontend/src/lib/api.ts:28` | Same-origin needs no build-time env |
| No `trustProxies` configured | `backend/bootstrap/app.php` | **Must be added** — see below |
| Nothing implements `ShouldQueue` | `grep -r ShouldQueue app/` → no hits | Mail is synchronous; **no queue worker needed** |
| Upload cap 10240 KB | `CreatePostRequest.php:28` | Sets `client_max_body_size` / PHP limits |
| Public disk URL = `APP_URL . '/storage'` | `config/filesystems.php:46` | Media served by nginx, never through PHP |
| `/api/testing/reset` gated to `APP_ENV=e2e` | `routes/api.php` | Cannot exist in production |
| Repo is public | `gh repo view` | GHCR packages can be public — no registry auth on the server |

## Design

### 1. Topology

Everything on **one origin**, so Sanctum's SPA cookie session is first-party and
CORS is not involved.

```
Internet ──443──▶ nginx-web-1 (existing edge)
                   ├─ games.online-trash.com  → unchanged
                   └─ online-trash.com        → proxy_pass host.docker.internal:8080
                                                     │
                              ┌──────────────────────┴───────────────────────┐
                              │  ladybug-web  (nginx:alpine + built SPA)     │
                              │    /          → dist, try_files → index.html │
                              │    /storage/  → alias to media bind-mount    │
                              │    /api, /up  → fastcgi_pass php:9000        │
                              └──────────────────────┬───────────────────────┘
                                                     │
                              ladybug-php (php:8.3-fpm) ──▶ ladybug-mysql (8.0)
```

The stack owns its own nginx rather than teaching the shared edge about Ladybug's
paths. It costs ~15 MiB and buys a self-contained unit that can be restarted,
rolled back, or torn down without touching the config that keeps Thousand online.
The edge gains exactly one `proxy_pass` block, the same shape as the existing
`/thousand/` one.

Media is served by `ladybug-web` straight off the bind-mount via `alias`, never
through PHP, with `expires 30d` + `Cache-Control: public, immutable` (size variants
are content-addressed and never rewritten). `storage:link` is therefore irrelevant
in production.

### 2. Images and the release pipeline

Two images, built by a new `.github/workflows/release.yml` on green master, tagged
`:latest` and `:<git-sha>`, pushed to GHCR as **public** packages.

**`ghcr.io/urmomeesak77/ladybug-php`** — multi-stage.
Stage 1 `composer:2` runs `composer install --no-dev --optimize-autoloader
--no-interaction`. Stage 2 is `php:8.3-fpm` carrying the same extension set as the
dev image (`pdo_mysql zip bcmath gd` with jpeg/freetype/webp, plus the `gifsicle`
and `imagemagick` apt packages the animated-media pipeline needs) **minus pcov**,
which is a coverage driver with no place in production. App code is baked in;
`.env` is mounted at runtime.

`config:cache` must not run at build time — it would freeze the build-time
environment into the image. The entrypoint runs
`config:cache && route:cache && view:cache` **after** the env file is mounted, then
execs `php-fpm`.

**`ghcr.io/urmomeesak77/ladybug-web`** — multi-stage. Stage 1 `node:20` runs
`npm ci && npm run build`. Stage 2 is `nginx:alpine` with `dist/` and the inner
server config baked in. No build args: `VITE_API_BASE_URL` stays unset because
same-origin already resolves to `''`.

MySQL is stock `mysql:8.0`, no custom image.

Building in CI rather than on the server is not a preference — a `tsc -b`
+ `vite build` and a `composer install` on 1 vCPU / 960 MiB with no swap would be
slow at best and OOM at worst, and it would repeat on every deploy.

### 3. Server layout — `/web/online-trash.com/`

```
docker-compose.yml     # prod stack, copied from the repo's deploy/
.env                   # compose vars: LADYBUG_TAG, MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD
backend.env            # Laravel env, chmod 600, mounted ro at /var/www/html/.env
deploy.sh              # pull → up -d → migrate --force → health check
backup.sh              # dump, encrypt, upload to FTPS, prune, disk check
restore.sh             # the DR path, exercised in the rehearsal
data/mysql/            # MySQL datadir bind-mount
data/storage/          # Laravel storage tree; media under app/public
data/backups/          # local .sql.gz.gpg, 5 retained
public/                # pre-existing; edge still mounts it, now unused
```

### 4. Configuration and secrets

**MySQL** first-init creates the `trashdb` database, the root account, **and** a
dedicated `ladybug` user scoped to that one database, via the image's
`MYSQL_USER`/`MYSQL_PASSWORD`. The application connects as `ladybug`; root exists
only for dumps and administration. **No port is published** — the database is
reachable only on the compose network, unlike dev, which publishes 4444 on
loopback.

Note the image applies these variables **only when initialising an empty datadir**.
Changing them later updates the container environment but not the server, which is
the same trap `.env.example` already documents for dev.

**Passwords are generated at setup, not chosen.** Both the MySQL root and `ladybug`
passwords are fresh random strings rather than the value from the original brief,
which is also the FTP account's password. Those FTP credentials sit in a
cron-invoked script on a shared hosting account; reusing the string would mean one
leak opens the database too.

**Where each secret lives** (all root-owned, `chmod 600`, none in the repo):

| Secret | Location |
| --- | --- |
| MySQL root password | `/web/online-trash.com/.env` → `MYSQL_ROOT_PASSWORD` |
| MySQL `ladybug` password | same `.env` → `MYSQL_PASSWORD`, and `backend.env` → `DB_PASSWORD` (must match) |
| `APP_KEY` | `backend.env` |
| SMTP credentials | `backend.env` (reused from dev — `smtp.zone.eu`, `no-reply@online-trash.com`) |
| FTPS backup credentials | `/root/.ladybug-ftp` |
| Backup GPG passphrase | `/root/.ladybug-backup-pass` **and the operator's password manager** |

The setup script prints the generated passwords once. The GPG passphrase is the one
secret that cannot be recovered from the backups themselves — it decrypts them — so
it must be copied into a password manager before the rehearsal. Everything else is
recoverable from the encrypted env bundle held off-box (§8).

**Production `backend.env` differences from dev:** `APP_ENV=production`,
`APP_DEBUG=false`, `APP_URL=https://online-trash.com`, `LOG_LEVEL=warning`,
`SESSION_SECURE_COOKIE=true`, `SESSION_DOMAIN=online-trash.com`,
`SANCTUM_STATEFUL_DOMAINS=online-trash.com,www.online-trash.com`,
`FRONTEND_URL=https://online-trash.com`, `QUEUE_CONNECTION=sync`,
`DB_USERNAME=ladybug`.

### 5. Resource budget and tuning

This is the binding constraint. Estimated steady state:

| Component | RSS |
| --- | --- |
| OS + dockerd | ~250 MiB |
| edge nginx + thousand | ~95 MiB |
| ladybug-mysql (tuned) | ~280 MiB |
| ladybug-php (master + 2–3 workers) | ~180 MiB |
| ladybug-web | ~15 MiB |
| **Total** | **~820 MiB of 960 MiB** |

Mandatory mitigations:

- **2 GiB swapfile**, `vm.swappiness=10`. There is none today, which makes any
  transient spike an OOM kill rather than a slowdown.
- MySQL: `--innodb-buffer-pool-size=96M --performance-schema=OFF
  --max-connections=30 --table-open-cache=200 --table-definition-cache=200`.
- php-fpm: `pm=ondemand`, `pm.max_children=3`, `pm.process_idle_timeout=30s`,
  `memory_limit=256M`.
- Docker log rotation via `/etc/docker/daemon.json` (`json-file`, 10 MiB × 3), so
  logs cannot fill the disk.

**Accepted risk:** uploads allow 10 MiB images and GD decodes to raw pixels, so a
high-resolution upload can transiently want several hundred MiB. Swap absorbs it. A
slow upload is the correct failure mode; an OOM kill of MySQL is not.

**Disk:** the stack adds roughly 3 GiB (mysql image ~600 MiB, our two images
~310 MiB, MySQL data ~250 MiB, media 1.3 GiB, capped backups ~560 MiB), leaving
~12 GiB free — thousands of typical memes of runway.

**Growing the disk is non-destructive** and worth recording, because the instinct
that it might not be is what prompted this section. `vda1` is physically the last
partition, so once Zone grows the virtual disk it is two commands, online, with the
site up:

```bash
growpart /dev/vda 1
resize2fs /dev/vda1
```

Both binaries are already installed. A reboot (or
`echo 1 > /sys/class/block/vda/device/rescan`) may be needed for the kernel to see
the new size. What **is** destructive is a VPS reset/reinstall, which wipes `vda`
entirely — that is what §8 exists for.

### 6. Edge nginx and TLS

A new `/web/nginx/conf.d/online-trash.com.conf`; the apex server blocks move out of
`default.conf`, which keeps the games blocks. It adds:

- an ACME challenge location on the apex `:80` block (**currently missing**),
- `www` → apex redirect on `:443`,
- HSTS,
- `client_max_body_size 12M` (10 MiB upload cap plus multipart overhead),
- the proxy block, forwarding `Host`, `X-Real-IP`, `X-Forwarded-For` and
  `X-Forwarded-Proto`.

**Renewal is repaired as part of this work**, not deferred. The cert expires
2026-09-02 and production will depend on it: the missing ACME location is added,
and a host cron runs `certbot renew --webroot -w /var/www/certbot` followed by an
`nginx -s reload`. This is pre-existing breakage rather than new scope, but
launching onto a cert that dies in five weeks is not a defensible position.

### 7. Data migration (one-time cutover)

1. `scripts/backup-db.ps1` dumps `trashdb` on the dev box; gzip, then `scp`.
2. Import into the prod container as root.
3. Media: there is no `rsync` on the Windows host, so stream it over SSH —
   `tar -cf - -C .../ladybug-storage/app/public . | ssh root@… 'tar -xf - -C
   /web/online-trash.com/data/storage/app/public'`. Only `app/public` moves; the
   rest of the storage skeleton (framework, logs, sessions, cache) is created
   fresh, since dev's is full of local state.
4. `chown -R 33:33 data/storage` for www-data.
5. Verify row counts for `trashposts`, `users`, `comments`, and spot-check that a
   post hash resolves to a file that exists on disk.
6. **Prune dev accounts.** Migrating everything carries dev email addresses and
   password hashes into production. Delete test accounts and confirm the intended
   superuser before the edge flip.

### 8. Backups and disaster recovery

A VPS reset wipes everything; there is no detachable volume. The framing that makes
this tractable: after cutover the server holds only **three** things that do not
already exist elsewhere. Code is on GitHub, images are on GHCR, and infra config is
in the repo's `deploy/`. What is unique to the box is `backend.env`, the MySQL
data, and the media tree.

**Target:** `ftp://sn-69-18.tll07.zoneas.eu/ladybug/` over **explicit FTPS**, on the
operator's existing Zone hosting account (~200 GiB available). Two verified
constraints:

- **Connect by hostname, never by IP.** The cert is a Sectigo wildcard for
  `*.tll07.zoneas.eu` (valid to 2027-01-03); the bare IP fails verification with
  `no alternative certificate subject name matches`. The server also refuses
  plaintext (`530 Only TLS connections allowed`), so `--ssl-reqd` is required
  regardless.
- **Never touch anything outside `/ladybug/`.** That account holds live web content
  — `htdocs`, `logs`, `stats`, and personal directories dating to 2012. Every path
  absolute under `/ladybug/`; no `mirror --delete` near the account root.

`backup.sh`, nightly by cron:

| Item | Method | Retention |
| --- | --- | --- |
| Database | `mysqldump --single-transaction --routines --no-tablespaces` → gzip → GPG AES256 → `/ladybug/db/` | **5 latest**, pruned remote and local |
| Env bundle | `backend.env` + compose `.env` → GPG → `/ladybug/env/` | 5 latest |
| Media | `lftp mirror -R --only-newer` → `/ladybug/media/` | mirror, unversioned |
| Disk | `df` over 80% → mail via the configured SMTP | — |

Media files are immutable once written, so an incremental mirror is correct; only
the first 1.3 GiB seed is slow, and it is Zone-internal (tll01 → tll07). This needs
`lftp` installed on the server — `curl` alone cannot do incremental sync. `lftp` is
a system package, not an application dependency, so Principle I is not engaged.

Dumps are GPG-encrypted because they carry user emails and bcrypt hashes and land
on a shared account that has a web docroot. `/ladybug/` is a sibling of `htdocs`
and so should not be web-served; encryption makes that assumption unnecessary.

**DR runbook** in `docs/DEPLOYMENT.md`: fresh VPS → `setup.sh` (swap, dirs, log
rotation, Docker) → fetch and decrypt the env bundle → `deploy.sh <tag>` → restore
the dump → `lftp mirror` the media down → install the edge config and reissue
certs. **This is rehearsed once before launch is called done.** An untested restore
is not a backup.

### 9. Code changes in the repo

One behavioural change. `bootstrap/app.php` configures `statefulApi`,
`EnsureAccountEnabled` and the `role` alias, but **no trusted proxies**. Behind the
edge, Laravel would see scheme `http` and the proxy's IP, which breaks the `https`
scheme in signed email-verification links and media URLs, and keys rate limiters on
the proxy instead of the client:

```php
$middleware->trustProxies(at: '*');
```

`at: '*'` is correct here because the stack binds to `127.0.0.1:8080` and only the
edge container can reach it.

Everything else is additive: new files under `deploy/`, the release workflow, and
`docs/DEPLOYMENT.md`.

## New files

```
deploy/
├── php/Dockerfile              # prod php-fpm image
├── php/php.ini                 # opcache (validate_timestamps=0), upload limits, memory_limit
├── php/www.conf                # pm=ondemand, max_children=3
├── php/entrypoint.sh           # config/route/view cache, then exec php-fpm
├── web/Dockerfile              # node:20 build → nginx:alpine
├── web/default.conf            # SPA fallback, /storage alias, fastcgi for /api and /up
├── docker-compose.prod.yml     # the stack
├── backend.env.example         # production Laravel env template (no secrets)
├── setup.sh                    # one-time server prep
├── deploy.sh                   # pull, migrate, health check
├── backup.sh                   # dump, encrypt, FTPS upload, prune, df check
├── restore.sh                  # DR path
└── nginx-edge/online-trash.com.conf
.github/workflows/release.yml
docs/DEPLOYMENT.md
```

## Cutover plan

| Phase | What | Reversible |
| --- | --- | --- |
| 0 | Server prep: swap, log rotation, dirs, `lftp`, ACME location fix | yes |
| 1 | Repo work; CI green; images in GHCR | nothing on prod yet |
| 2 | First `deploy.sh` — stack up on an empty DB, migrations run | `compose down` |
| 3 | Data migration (§7) | dump retained |
| 4 | Smoke-test over an SSH tunnel before any public traffic | nothing public yet |
| 5 | Edge flip: install the new conf, `nginx -s reload` | restore old conf |
| 6 | Backups, cert renewal cron, **restore rehearsal** | — |

Launch is not complete until phase 6 is green.

**Rollback** at any point: restore the previous `default.conf`, reload the edge, and
`compose down` the stack. The apex returns to its static placeholder. A bad release
specifically rolls back with `deploy.sh <previous-sha>`, since every build is tagged
by commit.

## Verification

`/api/health` and `/up` answer; the feed paginates; a permalink resolves; a media
variant loads with the expected cache headers; register → **the verification mail
actually arrives** via `smtp.zone.eu`; login sets a `Secure` cookie; upload both an
image and a YouTube link; post a comment; both admin consoles load; forcing a 500
returns no stack trace; `docker stats` after warm-up stays within the §5 budget.

## Security review

Against Constitution Principle VI:

- `APP_DEBUG=false`, `APP_ENV=production`, `LOG_LEVEL=warning`.
- Database reachable only on the compose network; no published port.
- Application connects as a non-root user scoped to one database.
- Distinct generated passwords; no reuse of the FTP credential.
- `SESSION_SECURE_COOKIE=true`, `SESSION_DOMAIN` pinned, HSTS at the edge.
- Secrets in root-only files outside the repo; `.env` is already gitignored.
- Backups encrypted at rest on third-party storage.
- No pcov and no dev Composer dependencies in the production image.
- `/api/testing/reset` cannot be registered outside `APP_ENV=e2e`.
- Existing upload validation and the `uploads`/`comments` rate limiters are
  unchanged and now sit behind a correctly-populated client IP.

### Secrets must never reach GitHub, GHCR, or the client bundle

The repository is **public** and so are the GHCR packages. Three separate places
can leak, and each needs its own guard.

1. **The repo.** No credential — MySQL, SMTP, FTP, `APP_KEY` — appears in any
   tracked file, including this design. `deploy/backend.env.example` is a template
   whose secret-bearing keys are empty; the real `backend.env` and compose `.env`
   are generated on the server by `setup.sh` and never leave it except as the
   GPG-encrypted bundle in §8. `backend/.gitignore` already covers `.env`,
   `.env.e2e` and `.env.production`; the root `.gitignore` gains a rule for
   `deploy/` env files so a stray real one cannot be staged. Verified at design
   time: `git log --all -S` finds neither the FTP nor the database credential
   anywhere in history, and no real `.env` has ever been committed.
2. **The images.** Secrets are never Docker build args and are never baked into a
   layer — image history is public on GHCR and `docker history` reveals build args.
   This is why `backend.env` is bind-mounted read-only at runtime and why
   `config:cache` runs in the entrypoint rather than at build time (§2).
3. **The client bundle.** No secret may ever be a `VITE_*` variable. Vite inlines
   those into the shipped JavaScript, which is served to every visitor. The SPA
   needs no secrets at all — same-origin means even the API base URL is empty.

CI itself holds no production credentials: the release workflow needs only the
built-in `GITHUB_TOKEN` to push to GHCR. Choosing manual deploys over auto-deploy
means no SSH private key, no database password and no SMTP password are ever stored
as GitHub secrets or risk appearing in a workflow log.

A credential scan (`git log --all -S` for each secret, plus a check that no real
`.env` is staged) runs before the first push and before each release.

## Constitution check

- **Principle I (minimal dependencies):** no new Composer or npm package. Additions
  are base images (`php:8.3-fpm`, `nginx:alpine`, `node:20`) mirroring what dev
  already uses, and one system package (`lftp`) on the server.
- **Principle VII (tests):** no source behaviour changes except trusted proxies;
  existing coverage gates are unaffected and CI must stay green before any image is
  published.
- **Conventions:** shell scripts and configs follow the existing `scripts/` style;
  comments explain *why*.

## Risks and non-goals

**Risks.** 960 MiB is genuinely tight (§5) and the first weeks should be watched.
A pathological upload can spike memory; swap is the mitigation. Zone's disk-grow
procedure is assumed to be grow-in-place — worth one support ticket to confirm,
though the guest-side steps are standard either way.

**Non-goals.** No staging environment, no CDN, no monitoring beyond the disk-usage
mail, no auto-deploy (releases are pulled manually so prod never changes
unobserved), no queue worker (nothing is queued). Password reset remains unbuilt
and out of scope.
