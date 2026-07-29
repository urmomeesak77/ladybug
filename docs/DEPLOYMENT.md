# Deployment

Operator runbook for running Ladybug at `https://online-trash.com` on the Zone.eu
VPS that also hosts the Thousand game. Written for someone who has the server
password and nothing else in their head — every path, script and flag below has
been checked against the actual contents of `deploy/`.

Background and rationale live in
`docs/superpowers/specs/2026-07-28-production-deployment-design.md`; this document
is the "what to actually type" companion to it.

## 1. Architecture

Everything sits on **one origin**, so the Sanctum SPA cookie session is
first-party and CORS never enters the picture:

```
Internet ──443──▶ nginx-web-1 (existing edge, /web/nginx)
                   ├─ games.online-trash.com  → unchanged (Thousand game)
                   └─ online-trash.com        → proxy_pass http://ladybug-web:80
                                                 (by container name, over the
                                                 shared `nginx_default` network)
                                                     │
                              ┌──────────────────────┴────────────────────────┐
                              │  ladybug-web  (nginx:alpine + built SPA)       │
                              │    /              → dist/, try_files → index  │
                              │    /storage/      → alias to media bind-mount │
                              │    /api /up /sanctum → fastcgi_pass php:9000  │
                              └──────────────────────┬────────────────────────┘
                                                      │
                              ladybug-php (php:8.3-fpm) ──▶ ladybug-mysql (8.0)
```

`ladybug-web` publishes **no port at all**. It is attached to two Compose
networks: its own stack's `default` (to reach `ladybug-php`) and `edge`, an
`external: true` network pointing at `nginx_default` — the network the shared
edge container (`nginx-web-1`) already runs on. The edge reaches it by
container name (`ladybug-web`), resolved per-request via Docker's embedded DNS
(`resolver 127.0.0.11`), the same pattern `deploy/web/default.conf` already
uses to reach `ladybug-php`.

This is **not** the mechanism used for the Thousand game, and deliberately so.
The original design published `ladybug-web` on `127.0.0.1:8080` and had the
edge reach it via `host.docker.internal` — exactly how Thousand is reached on
`:3000` — but that was measured broken on the real server:

```
host      -> 127.0.0.1:18099            = 200
container -> host.docker.internal:18099 = CONNECTION REFUSED
```

A loopback-published port is DNAT-scoped to `127.0.0.1/32`. `host.docker.internal`
resolves to the `docker0` bridge address (via `host-gateway`), which is a
*different* address than `127.0.0.1` from the container's point of view, so the
DNAT rule that makes `127.0.0.1:8080` work never fires for a request arriving
over the bridge. Docker Desktop masks this locally (it proxies loopback
publishes through its VM), which is why the bug never showed up in dev — only
on the real Linux host. The alternative, publishing on `0.0.0.0:8080`, was
rejected too: Docker's port-publishing `iptables` rules are inserted ahead of
`ufw`, so that would have made the stack reachable over plain HTTP from the
public internet regardless of any firewall rule. Sharing the edge's network and
publishing nothing avoids both failure modes.

**Why the stack still owns its own nginx** instead of teaching the shared edge
about Ladybug's paths: it costs roughly 15 MiB of RAM and buys a self-contained
unit that can be restarted, rolled back, or torn down entirely without touching
the edge config that keeps Thousand online. In exchange, the edge gains exactly
one `proxy_pass` block — the same shape as the existing `/thousand/` one,
nothing Ladybug-specific for it to know beyond the container name.

Media (`/storage/`) is served by `ladybug-web` straight off a bind-mount via
`alias`, never through PHP — size variants are content-addressed and never
rewritten, so they carry `expires 30d` and `Cache-Control: public, immutable`.
`php artisan storage:link` is therefore irrelevant in production.

## 2. Prerequisites

- **Root SSH access** to the VPS: `ssh root@online-trash.com` (currently
  `217.146.72.141`, a Zone.eu Ubuntu 24.04 virtual server).
- **Docker already installed and running.** The box already runs `nginx-web-1`
  (the shared edge) and the `thousand` container by hand, so Docker and Compose
  are a given on this specific host. A fresh VPS in the disaster-recovery path
  (Section 7) does not have this — Docker is installed there as an explicit
  step.
- **GHCR images are public.** `ghcr.io/urmomeesak77/ladybug-php` and
  `ghcr.io/urmomeesak77/ladybug-web` are public packages — the server needs no
  `docker login` to pull them.
- **DNS already points at the server.** `online-trash.com`,
  `www.online-trash.com` and `games.online-trash.com` already resolve to
  `217.146.72.141`. Nothing to change here for a routine deploy; only the
  disaster-recovery path re-points DNS, at a new IP.

## 3. First-time server setup

```sh
ssh root@online-trash.com
git clone https://github.com/urmomeesak77/ladybug.git /root/ladybug
bash /root/ladybug/deploy/setup.sh
```

`deploy/setup.sh` is idempotent — re-running it leaves existing secrets alone —
which is also why it doubles as the first step of disaster recovery on a fresh
VPS. In one pass it:

- adds a 2 GiB swapfile at `vm.swappiness=10` (the box ships with none, which
  otherwise turns any transient memory spike into an OOM kill instead of a
  slowdown);
- caps Docker's `json-file` logs at 10 MiB × 3 via `/etc/docker/daemon.json`;
- installs `lftp` (needed for the incremental FTPS media mirror in backups);
- creates `/web/online-trash.com/data/{mysql,storage/app/public,backups}` and
  `chown`s the storage tree to uid 33 (`www-data` inside the php container);
- copies `docker-compose.prod.yml` to `/web/online-trash.com/docker-compose.yml`
  and `deploy.sh` / `backup.sh` / `restore.sh` alongside it;
- generates `/web/online-trash.com/.env` (`LADYBUG_TAG`,
  `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`) and
  `/web/online-trash.com/backend.env` (from `deploy/backend.env.example`, with
  a fresh `APP_KEY` and the matching `DB_PASSWORD`) — both `chmod 600`;
  generates `/root/.ladybug-backup-pass` (`chmod 600`);
- creates a skeleton `/root/.ladybug-ftp` (`chmod 600`) with `FTP_HOST` filled
  in and `FTP_USER` / `FTP_PASS` blank.

Run it **interactively** — the script's own output warns against redirecting
its stdout to a file or a logged session, because it prints every generated
secret once, in a `SAVE THESE NOW` block. Copy the MySQL root password, the
MySQL app password, and the backup passphrase into a password manager before
doing anything else. **The backup passphrase cannot be recovered later — it is
what decrypts the backups.**

Two manual steps remain, called out at the end of the script's output:

1. Fill `MAIL_PASSWORD` in `/web/online-trash.com/backend.env` — copy the value
   from the dev `backend/.env` (same `smtp.zone.eu` / `no-reply@online-trash.com`
   mailbox).
2. Fill `FTP_USER` and `FTP_PASS` in `/root/.ladybug-ftp` — the dedicated
   Zone.eu backup account. **Single-quote the password**: it contains `/`,
   `=`, `?` and `+`, all of which an unquoted shell would mangle.

## 4. Edge nginx

1. Install the new config alongside the existing one:

   ```sh
   cp /root/ladybug/deploy/nginx-edge/online-trash.com.conf \
      /web/nginx/conf.d/online-trash.com.conf
   ```

2. Edit `/web/nginx/conf.d/default.conf` and remove the apex
   (`online-trash.com` / `www.online-trash.com`) `server{}` blocks — that
   domain's configuration now lives entirely in the new file. Leave the
   `games.online-trash.com` blocks in `default.conf` untouched.

3. Validate and reload:

   ```sh
   docker exec nginx-web-1 nginx -t
   docker exec nginx-web-1 nginx -s reload
   ```

**The ACME challenge / phase-order bug.** This is the least obvious thing in
this document, and it is why TLS renewal has been quietly broken. An nginx
`return` directive placed directly in a `server{}` block runs during the
**server-rewrite phase**, which happens *before* location matching. The
server's old apex `:80` block did exactly that — a bare `return 301` at server
level — so a sibling `location /.well-known/acme-challenge/` in the same block
was never reached; text order inside the file does not matter, the
server-rewrite phase always wins. Renewal has only been surviving because
Let's Encrypt happened to follow the resulting HTTP→HTTPS redirect into the
`:443` block's own duplicate of that location. `deploy/nginx-edge/online-trash.com.conf`
fixes this the correct way: the redirect lives inside `location /` instead of
at server level, so the more specific `/.well-known/acme-challenge/` location
wins during location matching, exactly as it should. Do not reintroduce a
server-level `return` here.

## 5. Releasing

CI (`.github/workflows/ci.yml`) must be green on `master`. The release workflow
(`.github/workflows/release.yml`) then triggers on that success, builds both
images from the exact validated commit, and pushes
`ghcr.io/urmomeesak77/ladybug-php` and `ghcr.io/urmomeesak77/ladybug-web`
tagged both `latest` and `<git-sha>`. There is no auto-deploy and no SSH key or
credential stored in CI — the server always pulls, nothing is ever pushed to
it.

```sh
cd /web/online-trash.com
./deploy.sh            # take latest
./deploy.sh <git-sha>   # pin to (or roll back to) an exact build
```

`deploy.sh` sets `LADYBUG_TAG` in `.env`, `docker compose pull`s,
`docker compose up -d --remove-orphans`, then runs
`docker compose exec -T ladybug-php php artisan migrate --force` against the
**new** image before polling the health endpoint for up to 20 seconds. The poll
runs `docker compose exec -T ladybug-web wget -qO- http://127.0.0.1/api/health`
**inside** the `ladybug-web` container, not from the host: the container
publishes no port (Section 1), so a host-side `curl` to a loopback port would
silently test nothing — it would report "healthy" from the host's own loopback
even if the edge could never reach the stack, which is exactly the bug that
motivated this design in the first place. If health never comes up it prints
`docker compose ps` and the last 50 lines of `docker compose logs`, then exits
non-zero — the stack is left running (not rolled back automatically) so you
have something to inspect.

Rollback is the same command with a previous SHA: every image is tagged by the
commit CI validated, so `./deploy.sh <previous-sha>` is a full rollback, code
and schema migrations included (migrations only ever move forward, so a
rollback that depends on a reverted migration needs a database restore too —
see Section 7).

**Two things that make the image safe to build and to run.** First, secrets
never enter the repo or an image: `.dockerignore` at the repo root excludes
`backend/.env*` and `frontend/.env*` from the build context, which is what
stops `COPY backend/ ./` in `deploy/php/Dockerfile` from baking a real
`backend/.env` into a public GHCR image — a review during Task 2 caught
exactly that leak. The same reasoning is why no `VITE_*` build arg is ever
passed to `deploy/web/Dockerfile`: Vite inlines those into the JavaScript
served to every visitor, so no secret can ever be one, and none is needed —
the SPA is same-origin, so even the API base URL is `''`.

Second, `deploy/php/entrypoint.sh` recreates the Laravel storage skeleton
(`storage/app/public`, `storage/framework/{cache/data,sessions,views}`,
`storage/logs`) on every container start, before running
`config:cache && route:cache && view:cache`. This is necessary, not
cosmetic: the compose bind-mount `./data/storage:/var/www/html/storage`
shadows whatever the image baked in, and on a fresh server that host
directory starts empty. Without the entrypoint recreating it, the first
request would fail — `SESSION_DRIVER=file`, `CACHE_STORE=file`, and the log
channel all write into that tree.

## 6. Backups

After cutover, the server holds exactly three things that do not already exist
somewhere else: `backend.env` (and the compose `.env` next to it), the MySQL
data, and the media tree. Code is on GitHub, images are on GHCR, and infra
config is in this repo's `deploy/`. `backup.sh`, run nightly by cron, ships all
three off-box:

| Item | Method | Where | Retention |
| --- | --- | --- | --- |
| Database | `mysqldump --single-transaction --routines --no-tablespaces`, gzip, GPG AES256 | `/db/` | **5 latest**, pruned remote and local |
| Env bundle (`backend.env` + `.env`) | tar, GPG AES256 | `/env/` | **5 latest**, pruned remote and local |
| Media | `lftp mirror -R --only-newer` (incremental) | `/media/` | mirror, unversioned |
| Disk | `df` over 80% on `/` → e-mail via the app's own SMTP config | — | — |

Local copies of the database and env bundle also sit in
`/web/online-trash.com/data/backups/`, pruned to the same 5.

**FTPS rules, all load-bearing:**

- **Connect by hostname, `sn-69-18.tll07.zoneas.eu`, never by IP.** The
  certificate is a wildcard for `*.tll07.zoneas.eu`; the bare IP fails TLS
  verification with `no alternative certificate subject name matches`.
- **The server refuses plaintext** (`530 Only TLS connections allowed`), hence
  `--ssl-reqd` on every `curl` call and `ftp:ssl-force true` in every `lftp`
  session.
- **The backup user is chrooted to its own root.** `/db`, `/env` and `/media`
  as used by the scripts are *that account's* root, not the shared hosting
  account's root — it cannot see `htdocs`, `logs`, or anything else on that
  account. Paths stay absolute under those three directories and `--delete` /
  `mirror --delete` are never used, even though the chroot is already the
  primary guard.
- **The password needs single-quoting** wherever it is written to a file —
  see Section 3.
- **`NLST` returns `.` and `..` as entries** on this server (measured
  2026-07-29), so anything that lists a remote directory must filter to the
  real filenames before acting on the result. Under C collation both sort
  *before* the timestamped dumps, so `sort | tail -1` ("newest") is safe, but
  `sort | head -n -5` ("all but the newest five") is not — it would hand `.`
  and `..` to `DELE`. `backup.sh`'s `prune_remote` takes a filename regex for
  exactly this reason; see the comment there before writing any new FTP
  listing code.

Credentials themselves are never in this document or in the repository: the
FTP username and password live only in `/root/.ladybug-ftp`, and the
passphrase that decrypts every backup lives only in
`/root/.ladybug-backup-pass` and the operator's password manager.

## 7. Disaster recovery: rebuilding on a fresh VPS

**Two different disasters, and this section only fully covers one of them.**

- **Data loss only** — the box itself survives (disk intact, `nginx-web-1` and
  `thousand` still running), but the Ladybug stack, its database, or its media
  is gone or corrupted. Steps 4-7 below apply as written, then Step 9
  (Post-deploy verification) — skip straight to those; the edge and Thousand
  need no attention.
- **Total loss** — a wiped/reprovisioned VPS. Steps 1-9 below rebuild
  *Ladybug*: for Ladybug specifically, everything except the backup
  passphrase, the FTP credentials, and SSH access is reproducible from GitHub
  and GHCR. But the same wipe also destroys the **shared edge**
  (`nginx-web-1`, `/web/nginx/docker-compose.yml`, `default.conf` with the
  games blocks, the certbot service and its cert store) and the **Thousand
  game** container, neither of which is tracked in this repo, and neither of
  which Steps 1-9 recreates on their own — Step 8 assumes `/web/nginx` and
  `nginx-web-1` already exist. On a genuine total loss, insert the rebuild
  **between Step 2 and Step 3**: Steps 1-2 provision the VPS and install
  Docker (a prerequisite the edge needs too), then rebuild the shared edge and
  Thousand from the Appendix below — it must be done before Step 8, which
  edits `/web/nginx/conf.d/default.conf` and runs `docker exec nginx-web-1
  nginx -t` — then continue with Step 3 onward as written. The Appendix is a
  snapshot, not a substitute for the live host, and may be stale by the time
  you need it.

1. Provision Ubuntu 24.04, point DNS at the new IP.
2. Install Docker, then `git clone https://github.com/urmomeesak77/ladybug.git /root/ladybug`.
3. Write `/root/.ladybug-backup-pass` (from the password manager) and
   `/root/.ladybug-ftp` (host, user, pass), both `chmod 600`. `/root/.ladybug-ftp`
   is shell-sourced by `backup.sh`/`restore.sh`, so it must match the skeleton
   `setup.sh` itself creates (Section 3): `FTP_HOST=`, `FTP_USER=`, and
   `FTP_PASS='...'` — **single-quoted**, since the password contains `/`, `=`,
   `?` and `+`.
4. `bash /root/ladybug/deploy/setup.sh`
5. Recover the previous secrets rather than using the freshly generated ones:
   download the newest `/env/env-*.tar.gz.gpg`, decrypt it, and put
   `backend.env` and `.env` in `/web/online-trash.com/`. **The old APP_KEY matters:
   a new one invalidates every existing session cookie.**
6. `cd /web/online-trash.com && ./deploy.sh latest`
7. `./restore.sh` -- imports the newest dump and mirrors the media back down.
8. Install the edge nginx config and reissue certificates with certbot.
9. Verify with the checklist in "Post-deploy verification".

Expanding a couple of the terser steps:

- **Step 5, decrypting the env bundle**, in full:

  ```sh
  . /root/.ladybug-ftp
  LATEST=$(curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" \
      --list-only "ftp://${FTP_HOST}/env/" | sort | tail -1)
  curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" \
      "ftp://${FTP_HOST}/env/${LATEST}" -o env.tar.gz.gpg
  gpg --batch --decrypt --passphrase-file /root/.ladybug-backup-pass \
      env.tar.gz.gpg | tar -xzf -
  mv backend.env .env /web/online-trash.com/
  # ladybug-php runs as www-data (uid 33) and reads this file bind-mounted
  # read-only -- root:root 600 (or a plain `mv` preserving that from the
  # archive) leaves it unreadable to the container. Same ownership setup.sh
  # itself applies when generating backend.env fresh (Section 3); entrypoint.sh
  # now refuses to start rather than boot silently against framework defaults
  # if this is ever wrong.
  chown root:33 /web/online-trash.com/backend.env
  chmod 640 /web/online-trash.com/backend.env
  ```

- **Step 7**, `restore.sh` (run from `/web/online-trash.com`), does the rest
  of the data path in one shot: it downloads and GPG-decrypts the newest
  `/db/` dump and imports it into `ladybug-mysql`, mirrors `/media/` back down
  into `data/storage/app/public` with `lftp`, `chown -R 33:33` that tree, then
  runs a verification query (row counts for `trashposts`, `users` and
  `comments`) followed by an `/api/health` check. Pass a specific filename
  (`./restore.sh trashdb-20260728-0230.sql.gz.gpg`) to restore something other
  than the newest dump; with no argument it restores the newest.

  Note there is no `php artisan tinker` in this project — `laravel/tinker` is
  not a Composer dependency at all, and the production image ships
  `--no-dev`. Everywhere this document or the scripts run an ad-hoc query
  against the booted application, it is the inline kernel-bootstrap pattern
  `restore.sh` itself uses:

  ```sh
  docker compose exec -T ladybug-php php -r '
  require "/var/www/html/vendor/autoload.php";
  $app = require "/var/www/html/bootstrap/app.php";
  $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
  echo "posts=", \App\Models\Trashpost::count(), PHP_EOL;
  '
  ```

- **Step 8**, edge and TLS. This assumes the shared edge already exists —
  either because this is a data-loss-only recovery, or because a total-loss
  recovery has already rebuilt it from the Appendix. Install Section 4's edge
  config, then issue fresh certificates (a fresh cert store has no existing
  registration or cert to renew):

  > **⚠ UNVERIFIED COMMAND.** Unlike every other command in this document,
  > the `certonly` invocation below was **not** copied from or checked against
  > a real config file — `/web/nginx/docker-compose.yml` and its `certbot`
  > service definition live only on the production server, not in this repo,
  > so there was nothing to verify it against. It was constructed by analogy
  > with the verified `certbot renew` invocation in Section 9, plus the flags
  > a *first-time* Let's Encrypt registration typically needs that `renew`
  > does not (renew reuses an already-registered account; a fresh VPS has
  > none). `docker compose run` has no TTY, so if these flags are wrong or
  > incomplete, an interactive prompt will hang rather than fail cleanly —
  > confirm the actual `certbot` service's entrypoint/image on the live host
  > (or in the Appendix, once recorded there) before running this for real.

  ```sh
  cd /web/nginx
  docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
      -n --agree-tos --email <operator-email> \
      -d online-trash.com -d www.online-trash.com -d games.online-trash.com
  docker exec nginx-web-1 nginx -s reload
  ```

  `-n` (non-interactive) and `--agree-tos` avoid the hang noted above;
  `--email <operator-email>` must be filled in (or replace both with
  `--register-unsafely-without-email` if no renewal-reminder address is
  wanted). Then re-add the renewal cron from Section 9.

### Rehearsing the restore without touching production

Rehearsed 2026-07-29 against the live backups. Repeat this after any change to
`backup.sh`, `restore.sh`, or the compose stack.

Stage a scratch copy under a **separate compose project** (`-p ladybug-dr`) in
`/tmp/ladybug-dr`, with its own `data/{mysql,storage/app/public,backups}`.

> **⚠ Detach the rehearsal stack from the edge network — this is the one step
> that can take the live site down.** `docker-compose.prod.yml` puts
> `ladybug-web` on the external `nginx_default` network, and the edge resolves
> its upstream by bare name (`set $upstream ladybug-web;` with Docker's
> embedded resolver, Section 4). Compose creates that network alias **per
> project**, so a rehearsal stack joining `nginx_default` registers a *second*
> container answering to `ladybug-web`, and the edge round-robins live traffic
> into the rehearsal. Before `up`, delete the `- edge` entry under
> `ladybug-web` and the top-level `networks:` block, then publish a loopback
> port instead (`127.0.0.1:8099:80` via a `docker-compose.override.yml`) so the
> rehearsal is reachable for verification but only from the host.

The rehearsal must recover the secrets **from the backup**, not from the live
`/web/online-trash.com/` — decrypting `/env/env-*.tar.gz.gpg` with
`/root/.ladybug-backup-pass` is the single step that proves the passphrase and
the bundle are both good, and it is the step you do not want to be attempting
for the first time during a real outage.

Then: `docker compose -p ladybug-dr up -d`, `artisan migrate --force`, import
the newest decrypted `/db/` dump, `artisan migrate --force` again (the dump
carries whatever schema it was taken at, which may be older than the running
code), and verify row counts against live. Tear down with
`docker compose -p ladybug-dr down -v && rm -rf /tmp/ladybug-dr`, then confirm
the **live** stack is still up and `https://online-trash.com/api/health`
answers 200.

**Measured 2026-07-29** (1 vCPU / 960 MiB box, live stack running alongside):

| Phase | Time |
| --- | --- |
| Recover + decrypt env bundle | seconds |
| DR stack up, MySQL healthy | ~15 s |
| `migrate` on an empty DB | ~30 s |
| Download + decrypt + import the dump (2619 posts, 256 KB compressed) | ~30 s |
| **Database/application path, end to end** | **under 5 minutes** |
| Media mirror back down (1.3 GB) | *not timed end to end* — the 1.3 GB **upload** took ~9 min, so budget 10–15 min |

Restored counts matched live exactly (`posts=2619 users=2 comments=0`), the
rehearsal stack answered `/api/health` and served a real feed, and the memory
headroom held (565 MiB available with both stacks up, 2 GiB swap barely
touched). The media mirror's **download** direction was verified separately on
one variant directory (2622 files, 133 MB): `diff -r` against the live
originals reported no differences.

### Post-deploy verification

Run through this after any disaster-recovery rebuild, and also after a normal
release you don't fully trust:

- `https://online-trash.com/api/health` and `https://online-trash.com/up`
  both answer.
- The feed loads and paginates (`GET /api/posts`).
- A permalink (`/posts/{hash}`) resolves.
- A media size variant loads with `Cache-Control: public, immutable` and a
  30-day `expires`.
- Register a new account and confirm the verification e-mail **actually
  arrives** via `smtp.zone.eu`; click the link and confirm verification
  succeeds.
- Log in and confirm the session cookie is `Secure`.
- Upload an image and a YouTube link.
- Post a comment.
- Both `/admin/trashposts` and `/admin/users` load for an admin account.
- Forcing a 500 returns no stack trace (`APP_DEBUG=false`).
- `docker stats --no-stream` after warm-up stays within the budget in
  Section 10.
- `https://games.online-trash.com/thousand/` still answers — confirms the edge
  change did not disturb the neighboring game.

### Appendix: shared edge and Thousand, as surveyed 2026-07-28

**Not tracked in this repo, not owned by Ladybug, and not exercised by any
script here.** Recorded only so a total-loss rebuild (see the note at the top
of Section 7) is not blind. This is a point-in-time snapshot — **the live host
is authoritative**; verify against it (`cat /web/nginx/docker-compose.yml`,
`docker inspect thousand`) before relying on this for a real rebuild, and
update this appendix if it drifts.

`/web/nginx/docker-compose.yml`:

```yaml
# /web/nginx/docker-compose.yml as surveyed 2026-07-28 -- NOT tracked in this repo.
# Recorded here so a total-loss rebuild is not blind. Verify against the live host
# before relying on it.
services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /web/online-trash.com/public:/usr/share/nginx/html
      - /web/games.online-trash.com/public:/usr/share/nginx/games
      - /web/nginx/conf.d:/etc/nginx/conf.d
      - /web/nginx/certbot/conf:/etc/letsencrypt
      - /web/nginx/certbot/www:/var/www/certbot
    restart: always

  certbot:
    image: certbot/certbot:latest
    volumes:
      - /web/nginx/certbot/conf:/etc/letsencrypt
      - /web/nginx/certbot/www:/var/www/certbot
```

The container name `nginx-web-1`, used throughout this document
(`docker exec nginx-web-1 nginx -t`, etc.), is Compose's default
`<project>-<service>-<replica>` name for the `web` service above — it depends
on the Compose project name at the directory it was brought up from, so
confirm it with `docker ps` after a rebuild rather than assuming it.

**Thousand**, started by hand rather than via Compose:

```sh
docker run -d --name thousand --restart unless-stopped \
    -p 3000:3000 \
    -e NODE_ENV=production \
    -e BASE_PATH=/thousand \
    -e ALLOWED_ORIGINS=https://games.online-trash.com \
    ghcr.io/urmomeesak77/thousand:latest
```

`extra_hosts: host.docker.internal:host-gateway` on the edge `web` service
above is what lets `default.conf`'s `games.online-trash.com` block reach
Thousand on `:3000` — rebuilding the edge without that line breaks the
Thousand proxy. Ladybug no longer depends on it: `ladybug-web` publishes no
port and is reached by container name over the shared `nginx_default` network
(Section 1), so rebuilding the edge for Ladybug instead requires that the
`ladybug-web` container be attached to this same Compose network (the `edge`
network declared `external: true` in `deploy/docker-compose.prod.yml`, which
*is* `nginx_default` — the default network name Compose derives from this
`/web/nginx` project directory).

## 8. Growing the disk

`vda1` is physically the **last** partition on the disk (the boot partitions
sit at the start), so growing the underlying virtual disk and extending the
filesystem into the new space is non-destructive and can be done live, with
the site up:

```sh
growpart /dev/vda 1
resize2fs /dev/vda1
```

Both binaries are already installed. A reboot (or
`echo 1 > /sys/class/block/vda/device/rescan`) may be needed for the kernel to
notice the larger disk before `growpart` sees anything to do. What **is**
destructive is a VPS reset/reinstall, which wipes `/dev/vda` entirely — that
is exactly what Section 7 exists for.

## 9. TLS renewal

Section 4 fixes the ACME challenge path; this section keeps the certificate
current going forward. Test with a dry run first:

```sh
cd /web/nginx
docker compose run --rm certbot renew --webroot -w /var/www/certbot --dry-run
```

Expect `Congratulations, all simulated renewals succeeded`. Then schedule it:

```sh
crontab -e
```

```cron
# TLS renewal: certbot no-ops until the cert is inside its 30-day window.
17 3 * * * cd /web/nginx && docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker exec nginx-web-1 nginx -s reload
```

**Verify expiry** at any time:

```sh
docker run --rm -v /web/nginx/certbot/conf:/etc/letsencrypt --entrypoint openssl \
  certbot/certbot x509 -in /etc/letsencrypt/live/online-trash.com/fullchain.pem \
  -noout -dates
```

`notAfter` should always read well over 30 days out; if it does not, the cron
entry above is missing or failing — check `crontab -l` and, if needed, re-run
the `--dry-run` command to see why.

## 10. Troubleshooting

First checks, in order:

```sh
free -h                                   # swap should exist and be mostly unused
docker stats --no-stream                  # per-container RSS
docker compose -f /web/online-trash.com/docker-compose.yml logs --tail=100 <service>
docker compose -f /web/online-trash.com/docker-compose.yml ps
```

`<service>` is one of `ladybug-mysql`, `ladybug-php` or `ladybug-web` — the
three service names are load-bearing throughout the stack (`fastcgi_pass
ladybug-php:9000` in `deploy/web/default.conf`, `DB_HOST=ladybug-mysql` in
`backend.env`), so they never change.

This box is genuinely tight on RAM (960 MiB, no swap until Section 3's setup
runs). The estimated steady-state budget:

| Component | RSS |
| --- | --- |
| OS + dockerd | ~250 MiB |
| edge nginx + Thousand | ~95 MiB |
| `ladybug-mysql` (tuned) | ~280 MiB |
| `ladybug-php` (master + 2–3 workers) | ~180 MiB |
| `ladybug-web` | ~15 MiB |
| **Total** | **~820 MiB of 960 MiB** |

If `docker stats` shows a container well above its line here, or `free -h`
shows swap climbing steadily rather than absorbing a brief spike, that is the
first sign of trouble — check that container's logs next.

A `ladybug-web` container that starts but returns `502` on every request
almost always means `ladybug-php` is unreachable: `deploy/web/default.conf`
resolves it per-request against Docker's embedded DNS
(`resolver 127.0.0.11`) precisely so `ladybug-web` can start and degrade to a
clean `502` instead of crash-looping when the backend is not yet up — which
happens on a host reboot, since Docker's daemon-triggered container restarts
do not honour `depends_on`. Check `ladybug-php`'s own logs and, if it never
comes healthy, `ladybug-mysql`'s.

An upload that hangs or a container that gets OOM-killed under a large image
is the accepted-risk case documented in the design spec: GD decodes a 10 MiB
upload to raw pixels in memory, which can transiently want several hundred
MiB. Swap should absorb it (a slow upload); if MySQL gets OOM-killed instead,
that is the failure mode Section 3's swapfile exists to prevent — check
`free -h` and `dmesg | grep -i oom`.
