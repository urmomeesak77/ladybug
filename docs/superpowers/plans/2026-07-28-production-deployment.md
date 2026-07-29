# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Ladybug at `https://online-trash.com` from the existing Zone.eu VPS, with the current database and 1.3 GB media library carried over, images built in CI, and encrypted off-box backups whose restore path has been rehearsed.

**Architecture:** A self-contained Compose stack (`ladybug-web` nginx + `ladybug-php` php-fpm + `ladybug-mysql`) publishes one loopback port, `127.0.0.1:8080`. The pre-existing edge nginx reverse-proxies `online-trash.com` to it, exactly as it already does for the Thousand game. Everything is one origin, so Sanctum's SPA cookie session is first-party and CORS is not involved. Images are built by GitHub Actions and pushed to GHCR; the server only ever pulls.

**Tech Stack:** PHP 8.3-fpm, nginx:alpine, MySQL 8.0, Node 20 (build-time only), Docker Compose v5, GitHub Actions, certbot/webroot, lftp over FTPS.

**Design spec:** `docs/superpowers/specs/2026-07-28-production-deployment-design.md`

## Global Constraints

- **No new Composer or npm dependency.** Base images and one server system package (`lftp`) only. Constitution Principle I.
- **No credential in any tracked file.** The repo and the GHCR packages are both **public**. No secrets as Docker build args (`docker history` is public), and never a `VITE_*` variable (Vite inlines those into the shipped JS).
- **Production config is non-negotiable:** `APP_ENV=production`, `APP_DEBUG=false`, `LOG_LEVEL=warning`, `SESSION_SECURE_COOKIE=true`, `DB_USERNAME=ladybug` (never root).
- **Registry:** `ghcr.io/urmomeesak77/ladybug-php` and `ghcr.io/urmomeesak77/ladybug-web`, tagged `latest` and `<git-sha>`, packages **public** so the server needs no `docker login`.
- **Server paths:** stack lives at `/web/online-trash.com/`; data under `./data/{mysql,storage,backups}`.
- **FTPS backups:** a dedicated user, **chrooted to its own root** (which is the `ladybug/` directory of the web hosting account — it cannot see `htdocs` or anything else). Backup paths are therefore `/db/`, `/env/`, `/media/` with no prefix. Host `sn-69-18.tll07.zoneas.eu` — **connect by hostname; the cert is `*.tll07.zoneas.eu` and the bare IP fails verification** — always `--ssl-reqd` (the server refuses plaintext). The password contains `/`, `=`, `?` and `+`, so it MUST be single-quoted in `/root/.ladybug-ftp`.
- **PHP style:** PSR-12, 4-space, `declare(strict_types=1)`, functions <30 lines. `docs/CODING_CONVENTIONS.md` is binding.
- **Backend commands run through Docker** — there is no local PHP.
- **`php artisan tinker` does NOT exist in this project.** `laravel/tinker` is not a
  dependency (not in `require`, not in `require-dev`), and adding it would be a
  Principle I decision requiring explicit approval — besides being a poor idea in
  production. Where an ad-hoc query is needed, boot the framework directly; this is
  the same sequence Artisan performs, and it is proven working against the
  production image:
  ```sh
  docker compose exec -T ladybug-php php -r '
  require "/var/www/html/vendor/autoload.php";
  $app = require "/var/www/html/bootstrap/app.php";
  $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
  echo config("app.env"), PHP_EOL;
  '
  ```
  Facades (`DB::`, `Mail::`) and models are available after `bootstrap()`, because
  that is what registers them. Where a shipped Artisan command can cross-check the
  same fact (`php artisan about --json`, `php artisan db:show`), use it as a second
  independent signal so a bootstrap mistake cannot fake a pass.
- **Coverage gate ≥90%** on both stacks; CI must be green before any image is published.
- **Do not create branches.** Commit on `master`.

---

# Phase A — Repository work

Nothing in this phase touches production. All of it is verifiable locally and in CI.

---

### Task 1: Trust the edge proxy

Behind the edge, Laravel currently sees scheme `http` and the proxy's IP. That breaks the `https` scheme in signed email-verification links and media URLs, and keys the `uploads`/`comments` rate limiters on the proxy instead of the client.

**Files:**
- Modify: `backend/bootstrap/app.php`
- Test: `backend/tests/Feature/Http/Middleware/TrustedProxiesTest.php` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: production requests carrying `X-Forwarded-Proto: https` are treated as secure. Task 7's edge config sets that header; Task 15 verifies it end to end.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/Feature/Http/Middleware/TrustedProxiesTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * The production stack sits behind the edge nginx, which terminates TLS and forwards
 * over plain HTTP. Without trusted proxies Laravel believes the request is insecure and
 * builds http:// URLs -- which breaks signed e-mail verification links (they are signed
 * over the URL, so a scheme mismatch invalidates the signature) and every media URL,
 * since the public disk derives its URL from APP_URL.
 */
final class TrustedProxiesTest extends TestCase
{
    private function defineSchemeProbe(): void
    {
        Route::get('/_probe/scheme', static fn (Request $request): array => [
            'secure' => $request->isSecure(),
            'scheme' => $request->getScheme(),
            'ip' => $request->ip(),
        ]);
    }

    public function test_forwarded_proto_header_marks_the_request_secure(): void
    {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme', ['X-Forwarded-Proto' => 'https'])
            ->assertOk()
            ->assertJson(['secure' => true, 'scheme' => 'https']);
    }

    public function test_forwarded_for_header_resolves_the_real_client_ip(): void
    {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme', ['X-Forwarded-For' => '203.0.113.7'])
            ->assertOk()
            ->assertJson(['ip' => '203.0.113.7']);
    }

    public function test_a_request_without_forwarded_headers_stays_insecure(): void
    {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme')
            ->assertOk()
            ->assertJson(['secure' => false, 'scheme' => 'http']);
    }
}
```

- [ ] **Step 2: Run the test and verify it fails**

```sh
docker run --rm -v "${PWD}/backend:/app" ladybug-php \
  php artisan test --filter=TrustedProxiesTest
```

Expected: the first two tests FAIL (`secure` is `false`, `ip` is `127.0.0.1`) because `bootstrap/app.php` configures no trusted proxies. The third passes already.

If all three pass unexpectedly, **stop** — the framework default has changed and the premise needs re-checking before proceeding.

- [ ] **Step 3: Configure trusted proxies**

In `backend/bootstrap/app.php`, inside the `->withMiddleware(...)` closure, after the `$middleware->alias([...])` line:

```php
        // The production stack binds to 127.0.0.1:8080 and is reachable only by the edge
        // nginx on the same host, so every proxy that can reach us is ours to trust. Without
        // this Laravel sees the proxy's IP and scheme http: signed verification links would
        // be built (and validated) over the wrong scheme, media URLs would be http, and the
        // uploads/comments rate limiters would key every visitor to one bucket.
        $middleware->trustProxies(at: '*');
```

- [ ] **Step 4: Run the test and verify it passes**

```sh
docker run --rm -v "${PWD}/backend:/app" ladybug-php \
  php artisan test --filter=TrustedProxiesTest
```

Expected: 3 passed.

- [ ] **Step 5: Run the full gate**

```sh
docker run --rm -v "${PWD}/backend:/app" ladybug-php php vendor/bin/pint --test
docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test --coverage-clover=coverage.clover
python .github/scripts/check_coverage.py backend/coverage.clover 90
```

Expected: Pint clean, full suite green, coverage ≥90%.

- [ ] **Step 6: Commit**

```bash
git add backend/bootstrap/app.php backend/tests/Feature/Http/Middleware/TrustedProxiesTest.php
git commit -m "feat(deploy): trust the reverse proxy for scheme and client IP"
```

---

### Task 2: Production PHP image

**Files:**
- Create: `deploy/php/Dockerfile`, `deploy/php/php.ini`, `deploy/php/www.conf`, `deploy/php/entrypoint.sh`

**Interfaces:**
- Produces: an image exposing **php-fpm on port 9000**, application root `/var/www/html`, expecting `.env` bind-mounted at `/var/www/html/.env` and the storage tree at `/var/www/html/storage`. Task 3's nginx targets `fastcgi_pass ladybug-php:9000` with `SCRIPT_FILENAME /var/www/html/public/index.php`.

- [ ] **Step 1: Write `deploy/php/php.ini`**

```ini
; Production PHP settings for the Ladybug API. Contrast docker/php/opcache.ini, which
; tunes the DEV image running off a Windows bind mount.

; validate_timestamps=0 is correct here and wrong in dev: production code is baked into
; an immutable image layer, so it cannot change under a running container. A deploy is
; always a new container, which is always a cold opcache.
opcache.enable=1
opcache.validate_timestamps=0
opcache.memory_consumption=96
opcache.max_accelerated_files=20000
opcache.interned_strings_buffer=16

; CreatePostRequest caps images at 10240 KB (10 MiB). post_max_size leaves headroom for
; the multipart envelope and the title field.
upload_max_filesize=10M
post_max_size=12M

; GD decodes a JPEG to raw pixels, so a high-resolution 10 MiB upload can transiently
; want several hundred MB. 256M bounds a single worker on a 960 MiB box; swap absorbs
; the spike. A slow upload is the right failure mode -- an OOM kill of MySQL is not.
memory_limit=256M
max_execution_time=60

expose_php=Off
display_errors=Off
log_errors=On
; Docker collects the container's stderr, so errors land in `docker compose logs`.
error_log=/proc/self/fd/2
```

- [ ] **Step 2: Write `deploy/php/www.conf`**

```ini
; php-fpm pool sized for a 1 vCPU / 960 MiB box already hosting MySQL, two nginx
; instances and the Thousand game.
[www]
listen = 9000

; ondemand, not dynamic: idle workers are reaped, so a quiet site costs one master
; process rather than a permanently resident pool.
pm = ondemand
pm.max_children = 3
pm.process_idle_timeout = 30s
; Recycle workers periodically so a slow leak in the image pipeline cannot accumulate.
pm.max_requests = 500

; Send worker stdout/stderr to the container log instead of swallowing it.
catch_workers_output = yes
decorate_workers_output = no
```

- [ ] **Step 3: Write `deploy/php/entrypoint.sh`**

```sh
#!/bin/sh
# Cache config, routes and views at CONTAINER START -- never at image build.
# config:cache freezes whatever environment it can see into a PHP file; running it
# during the build would bake the BUILDER's environment into a public image and
# then ignore the real .env that gets bind-mounted at run time.
set -e

php artisan config:cache
php artisan route:cache
php artisan view:cache

exec "$@"
```

- [ ] **Step 4: Write `deploy/php/Dockerfile`**

```dockerfile
# Production image for the Ladybug API: PHP 8.3 FPM behind the stack's own nginx.
# Mirrors the dev image (docker/php/Dockerfile) MINUS pcov, which is a coverage
# driver with no place in production, and minus the dev Composer dependencies.
#
# Build context is the REPO ROOT, so this can copy backend/ (see release.yml).

FROM composer:2 AS vendor
WORKDIR /app
# Dependency manifests first: this layer is cached until composer.lock changes.
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress \
        --no-scripts --no-autoloader
COPY backend/ ./
# package:discover is run explicitly rather than via the post-autoload-dump hook so
# the build fails loudly on it instead of silently skipping with --no-scripts.
RUN composer dump-autoload --optimize --no-dev --no-interaction --no-scripts \
    && php artisan package:discover --ansi

FROM php:8.3-fpm

# Same system libraries and animated-media resizers as the dev image: gifsicle for
# animated GIFs, imagemagick (`convert`) for animated WebP -- GD reads only the first
# frame, so resizing either in PHP would flatten it. libwebp-dev enables GD's WebP
# read/write. No git/unzip: Composer already ran in the vendor stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev \
        gifsicle imagemagick \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-configure gd --with-jpeg --with-freetype --with-webp \
    && docker-php-ext-install pdo_mysql zip bcmath gd opcache

COPY deploy/php/php.ini /usr/local/etc/php/conf.d/zz-ladybug.ini
COPY deploy/php/www.conf /usr/local/etc/php-fpm.d/zz-ladybug.conf
COPY deploy/php/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /var/www/html
COPY --from=vendor --chown=www-data:www-data /app /var/www/html

# Drop root: the entrypoint writes bootstrap/cache and storage, both owned by www-data.
USER www-data

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["php-fpm"]
```

- [ ] **Step 5: Build the image**

```sh
docker build -f deploy/php/Dockerfile -t ladybug-php-prod:test .
```

Expected: build succeeds.

- [ ] **Step 6: Verify the image contents**

```sh
# Required extensions present, pcov absent.
docker run --rm ladybug-php-prod:test php -m | grep -E "^(pdo_mysql|zip|bcmath|gd|Zend OPcache)$"
docker run --rm ladybug-php-prod:test php -m | grep -c pcov || echo "pcov absent (correct)"

# GD really has WebP, as CI asserts for the dev image.
docker run --rm ladybug-php-prod:test php -r 'exit(function_exists("imagecreatefromwebp") ? 0 : 1);' \
  && echo "GD WebP OK"

# Animated-media resizers present.
docker run --rm ladybug-php-prod:test sh -c 'command -v gifsicle && command -v convert'

# No dev dependencies shipped.
docker run --rm ladybug-php-prod:test sh -c 'ls vendor/bin/ | grep -E "phpunit|pint"' \
  && echo "UNEXPECTED dev deps" || echo "no dev deps (correct)"

# Production settings applied.
docker run --rm ladybug-php-prod:test php -i | grep -E "opcache.validate_timestamps|memory_limit|upload_max_filesize"
```

Expected: the four extensions listed, `pcov absent`, `GD WebP OK`, both resizer paths printed, `no dev deps (correct)`, and `validate_timestamps => 0`, `memory_limit => 256M`, `upload_max_filesize => 10M`.

- [ ] **Step 7: Commit**

```bash
git add deploy/php/
git commit -m "feat(deploy): production php-fpm image"
```

---

### Task 3: Production web image

**Files:**
- Create: `deploy/web/Dockerfile`, `deploy/web/default.conf`

**Interfaces:**
- Consumes: `ladybug-php:9000` from Task 2.
- Produces: an image listening on **port 80**, expecting the media directory bind-mounted read-only at `/srv/media`. Task 4's compose publishes it on `127.0.0.1:8080`.

- [ ] **Step 1: Write `deploy/web/default.conf`**

```nginx
# The Ladybug stack's own nginx: serves the built SPA, serves media straight off the
# storage bind mount, and forwards the application routes to php-fpm. The shared edge
# nginx proxies to this and needs to know nothing about Ladybug's paths.

server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # The edge caps this too; repeated so the limit holds however the stack is reached.
    # 10 MiB image cap (CreatePostRequest) plus multipart overhead.
    client_max_body_size 12M;

    # Media: served directly off the bind mount, never through PHP. Size variants are
    # content-addressed and never rewritten, so they are safe to mark immutable.
    # This is why `artisan storage:link` is irrelevant in production.
    location /storage/ {
        alias /srv/media/;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Hashed Vite assets are immutable by construction.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Application routes. /sanctum is required: the SPA fetches /sanctum/csrf-cookie
    # before every mutating request (frontend/src/lib/csrf.ts). /up is the framework
    # health route declared in bootstrap/app.php's withRouting(health:).
    location ~ ^/(api|up|sanctum)(/|$) {
        include fastcgi_params;

        # Resolve php-fpm per REQUEST, not at config load. A bare hostname makes nginx
        # refuse to START whenever ladybug-php is not yet resolvable -- which happens on
        # a host reboot, where Docker's daemon-triggered restarts do not honour
        # depends_on. With a variable upstream nginx starts regardless, and a down
        # backend degrades to a clean 502 instead of a dead web container.
        # 127.0.0.11 is Docker's embedded DNS, present on every Compose network.
        resolver 127.0.0.11 valid=10s;
        set $upstream ladybug-php;
        fastcgi_pass $upstream:9000;

        # SCRIPT_FILENAME is resolved inside the PHP container's own filesystem, so this
        # nginx never needs a copy of the application code.
        fastcgi_param SCRIPT_FILENAME /var/www/html/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param DOCUMENT_ROOT /var/www/html/public;
        fastcgi_read_timeout 60s;
    }

    # Every other path is a client-side route: hand back the SPA shell.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Write `deploy/web/Dockerfile`**

```dockerfile
# Production image for the Ladybug SPA. Built in CI: a `tsc -b && vite build` on the
# 1 vCPU / 960 MiB server would be slow at best and OOM at worst, and would repeat on
# every deploy.
#
# Build context is the REPO ROOT (see release.yml).

FROM node:20 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Deliberately NO VITE_API_BASE_URL: the SPA and API share an origin in production, and
# Api.base() (frontend/src/lib/api.ts) already falls back to '' when the var is unset.
# Note also that no secret may EVER be passed as a VITE_* var -- Vite inlines those into
# the JavaScript served to every visitor.
RUN npm run build

FROM nginx:alpine
COPY deploy/web/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: Build the image**

```sh
docker build -f deploy/web/Dockerfile -t ladybug-web-prod:test .
```

Expected: build succeeds; the `npm run build` step runs `tsc -b && vite build` and emits `dist/`.

- [ ] **Step 4: Verify the config parses and the SPA is present**

```sh
docker run --rm ladybug-web-prod:test nginx -t
docker run --rm ladybug-web-prod:test ls /usr/share/nginx/html
docker run --rm ladybug-web-prod:test sh -c 'ls /usr/share/nginx/html/assets | head -3'
```

Expected: `syntax is ok` / `test is successful`; `index.html` and `assets` listed; hashed asset filenames printed.

This passes standalone only because of the `resolver` + variable-upstream form above. With
a bare `fastcgi_pass ladybug-php:9000`, nginx resolves the name at config-load time and
this command fails with `host not found in upstream` for everyone, every time.

Then prove the container survives an unresolvable backend — the failure mode the variable
upstream exists to remove:

```sh
docker run -d --name lbweb-test -p 127.0.0.1:8099:80 ladybug-web-prod:test
sleep 3 && docker ps --filter name=lbweb-test --format '{{.Status}}'
curl -s -o /dev/null -w 'api=%{http_code}
'   http://127.0.0.1:8099/api/posts
curl -s -o /dev/null -w 'spa=%{http_code}
'   http://127.0.0.1:8099/
curl -s -o /dev/null -w 'route=%{http_code}
' http://127.0.0.1:8099/posts/abcdefghij
docker ps --filter name=lbweb-test --format '{{.Status}}'
docker rm -f lbweb-test
```

Expected: running (not restarting); `api=502`, `spa=200`, `route=200`; and **still running**
after the 502.

- [ ] **Step 5: Confirm no secret leaked into the bundle**

```sh
docker run --rm ladybug-web-prod:test sh -c \
  'grep -rilE "MAIL_PASSWORD|DB_PASSWORD|APP_KEY|smtp\.zone\.eu" /usr/share/nginx/html || echo "clean"'
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add deploy/web/
git commit -m "feat(deploy): production nginx + SPA image"
```

---

### Task 4: Production compose stack and env template

**Files:**
- Create: `deploy/docker-compose.prod.yml`, `deploy/backend.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: both images from Tasks 2–3.
- Produces: services named **`ladybug-mysql`, `ladybug-php`, `ladybug-web`** (the service name is the DNS name the nginx `fastcgi_pass` relies on), publishing `127.0.0.1:8080`. Tasks 8–9's scripts drive this file.

- [ ] **Step 1: Write `deploy/docker-compose.prod.yml`**

```yaml
# Production stack for online-trash.com, deployed to /web/online-trash.com/ on the
# Zone.eu VPS. Nothing is BUILT here -- images come from GHCR and the server only pulls
# (1 vCPU / 960 MiB). Compare docker-compose.yml, which is dev-only and says so.
#
# Service names are load-bearing: deploy/web/default.conf does `fastcgi_pass
# ladybug-php:9000` and backend.env sets DB_HOST=ladybug-mysql.
services:
  ladybug-mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: trashdb
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?must be set in .env}
      # First init also creates this non-root user with privileges on trashdb ONLY.
      # The application connects as this user; root exists for dumps and admin.
      MYSQL_USER: ladybug
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?must be set in .env}
    # NOTE: like the dev compose, these apply only when initialising an EMPTY datadir.
    # Changing them against an existing ./data/mysql updates the container environment
    # but NOT the server, and auth then breaks. Use ALTER USER on a live server instead.
    #
    # Tuned for a 960 MiB box shared with php-fpm, two nginx instances and Thousand.
    command:
      - --innodb-buffer-pool-size=96M
      - --performance-schema=OFF
      - --max-connections=30
      - --table-open-cache=200
      - --table-definition-cache=200
    # No published port, unlike dev: the database is reachable only on this network.
    volumes:
      - ./data/mysql:/var/lib/mysql
    healthcheck:
      # No -p: mysqladmin ping exits 0 whenever the server is up, even on Access denied,
      # so a password would only leak into `docker inspect`. Same rationale as dev.
      test: ["CMD", "mysqladmin", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  ladybug-php:
    image: ghcr.io/urmomeesak77/ladybug-php:${LADYBUG_TAG:-latest}
    restart: unless-stopped
    volumes:
      # Mounted at run time, never baked: the image is public on GHCR.
      - ./backend.env:/var/www/html/.env:ro
      - ./data/storage:/var/www/html/storage
    depends_on:
      ladybug-mysql:
        condition: service_healthy

  ladybug-web:
    image: ghcr.io/urmomeesak77/ladybug-web:${LADYBUG_TAG:-latest}
    restart: unless-stopped
    ports:
      # Loopback only. The edge nginx reaches this via host.docker.internal:8080,
      # exactly as it reaches the Thousand game on :3000.
      - "127.0.0.1:8080:80"
    volumes:
      - ./data/storage/app/public:/srv/media:ro
    depends_on:
      - ladybug-php
```

- [ ] **Step 2: Write `deploy/backend.env.example`**

Every secret-bearing key is deliberately empty — `setup.sh` (Task 8) fills them in on the server.

```ini
# Production Laravel environment TEMPLATE. setup.sh copies this to
# /web/online-trash.com/backend.env and fills in the generated secrets.
#
# NEVER commit a filled-in copy. The repository is public.

APP_NAME=Online-Trash
APP_ENV=production
# Generated by setup.sh: base64:<32 random bytes>
APP_KEY=
APP_DEBUG=false
APP_URL=https://online-trash.com

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US
APP_MAINTENANCE_DRIVER=file

BCRYPT_ROUNDS=12
COMMENT_THROTTLE=10

LOG_CHANNEL=stack
LOG_STACK=single
LOG_DEPRECATIONS_CHANNEL=null
LOG_LEVEL=warning

# Non-root user, scoped by MySQL first-init to the trashdb database only.
DB_CONNECTION=mysql
DB_HOST=ladybug-mysql
DB_PORT=3306
DB_DATABASE=trashdb
DB_USERNAME=ladybug
DB_PASSWORD=

SESSION_DRIVER=file
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=online-trash.com
# The site is HTTPS-only, so the session cookie must never travel in clear.
SESSION_SECURE_COOKIE=true

SANCTUM_STATEFUL_DOMAINS=online-trash.com,www.online-trash.com
FRONTEND_URL=https://online-trash.com

BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
# Nothing in app/ implements ShouldQueue, so mail is sent synchronously and there is
# no queue worker to run. Anything queued under a `database` driver would never run.
QUEUE_CONNECTION=sync
CACHE_STORE=file

# Reused from the dev configuration: a real mailbox on the domain.
MAIL_MAILER=smtp
MAIL_SCHEME=null
MAIL_HOST=smtp.zone.eu
MAIL_PORT=587
MAIL_USERNAME="no-reply@online-trash.com"
MAIL_PASSWORD=
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="no-reply@online-trash.com"
MAIL_FROM_NAME="${APP_NAME}"
```

- [ ] **Step 3: Guard against a real env file being staged**

Append to `.gitignore`:

```gitignore
# Production env files are generated on the server and must never be committed --
# the repository is public. Only the .example templates belong here.
/deploy/**/.env
/deploy/backend.env
/deploy/data/
```

- [ ] **Step 4: Verify the compose file is valid and the guards hold**

```sh
# Config renders (the :? guards fire without an .env, which is the point).
docker compose -f deploy/docker-compose.prod.yml config 2>&1 | head -5

MYSQL_ROOT_PASSWORD=x MYSQL_PASSWORD=y \
  docker compose -f deploy/docker-compose.prod.yml config --quiet && echo "compose OK"

# The template really is secret-free.
grep -E "^(APP_KEY|DB_PASSWORD|MAIL_PASSWORD)=$" deploy/backend.env.example \
  && echo "template has no secrets"
```

Expected: the first command errors mentioning `MYSQL_ROOT_PASSWORD` (the guard works); then `compose OK`; then all three keys shown empty.

- [ ] **Step 5: Commit**

```bash
git add deploy/docker-compose.prod.yml deploy/backend.env.example .gitignore
git commit -m "feat(deploy): production compose stack and env template"
```

---

### Task 5: Prove the stack works end to end on the dev box

Do not discover a broken stack on a 960 MiB server. This runs the real production images locally against a throwaway database.

**Files:** none created. Uses a scratch directory so the repo stays clean.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: confidence, plus the exact failure modes Task 12 might otherwise hit blind.

- [ ] **Step 1: Stage a scratch deployment**

Compose resolves relative bind mounts against the compose file's directory, so copy it somewhere disposable rather than polluting `deploy/`.

```sh
SCRATCH="$HOME/AppData/Local/Temp/claude/ladybug-prodtest"
mkdir -p "$SCRATCH/data/storage/app/public" "$SCRATCH/data/mysql"
cp deploy/docker-compose.prod.yml "$SCRATCH/docker-compose.yml"
cp deploy/backend.env.example "$SCRATCH/backend.env"
```

- [ ] **Step 2: Fill in throwaway secrets**

```sh
cd "$SCRATCH"
printf 'LADYBUG_TAG=test\nMYSQL_ROOT_PASSWORD=testroot\nMYSQL_PASSWORD=testapp\n' > .env
sed -i 's|^APP_KEY=.*|APP_KEY=base64:'"$(openssl rand -base64 32)"'|' backend.env
sed -i 's|^DB_PASSWORD=.*|DB_PASSWORD=testapp|' backend.env
# Local test only: there is no TLS in front of this scratch stack.
sed -i 's|^SESSION_SECURE_COOKIE=.*|SESSION_SECURE_COOKIE=false|' backend.env
sed -i 's|^APP_URL=.*|APP_URL=http://localhost:8080|' backend.env
sed -i 's|^MAIL_MAILER=.*|MAIL_MAILER=log|' backend.env
```

- [ ] **Step 3: Point the compose file at the locally built images**

Retag the local builds under the real image names rather than editing the compose
file, so the scratch run exercises the file exactly as production will:

```sh
docker tag ladybug-php-prod:test ghcr.io/urmomeesak77/ladybug-php:test
docker tag ladybug-web-prod:test ghcr.io/urmomeesak77/ladybug-web:test
```

`.env` already pins `LADYBUG_TAG=test` (Step 2), so compose resolves to these local
tags. Add `pull_policy: never` under both image services in the scratch
`docker-compose.yml` so Compose cannot try to fetch `:test` from GHCR.

- [ ] **Step 4: Bring the stack up and migrate**

```sh
docker compose up -d
docker compose ps
docker compose exec -T ladybug-php php artisan migrate --force
```

Expected: three services `running`, `ladybug-mysql` healthy, migrations run to completion.

- [ ] **Step 5: Verify every routing class works**

```sh
# API through fastcgi.
curl -fsS http://127.0.0.1:8080/api/health;                echo
# Framework health route.
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/up
# Sanctum CSRF cookie (the SPA calls this before every mutation).
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/sanctum/csrf-cookie
# Feed endpoint against the empty DB.
curl -fsS http://127.0.0.1:8080/api/posts;                 echo
# SPA shell.
curl -fsS http://127.0.0.1:8080/ | head -c 100;            echo
# SPA fallback: a client-side route must return the shell, not 404.
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/posts/abcdefghij
# Media alias, with cache headers.
echo probe > data/storage/app/public/probe.txt
curl -fsS -D- -o /dev/null http://127.0.0.1:8080/storage/probe.txt | grep -iE "HTTP/|cache-control"
```

Expected: `{"status":"ok"}`; `200`; `204`; a JSON feed envelope; `<!doctype html`; `200` for the SPA fallback; `200` plus `Cache-Control: public, immutable` for the media probe.

- [ ] **Step 6: Verify production hardening is actually on**

```sh
# Debug must be off: a forced error must not return a stack trace.
curl -s http://127.0.0.1:8080/api/posts/does-not-exist | head -c 200; echo
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo config("app.debug") ? "DEBUG ON (BAD)" : "debug off (correct)", PHP_EOL;
'
# The app must be connected as the non-root user.
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo DB::selectOne("select current_user() u")->u, PHP_EOL;
'
# Cross-check both facts with commands that DO ship, so a bootstrap mistake in the
# two snippets above cannot manufacture a false pass.
docker compose exec -T ladybug-php php artisan about --json | head -c 300; echo
docker compose exec -T ladybug-php php artisan db:show | head -20
```

Expected: a plain JSON 404 with no trace; `debug off (correct)`; a `ladybug@%` current user (**not** `root@`); and from the cross-checks `"debug_mode":false` plus a `Username ... ladybug` row.

- [ ] **Step 7: Tear down and clean up**

```sh
docker compose down -v
cd - && rm -rf "$SCRATCH"
```

- [ ] **Step 8: Record the result**

No commit — this task produces no files. Report the verified behaviours to the reviewer. **If any check failed, fix the owning task (2, 3, or 4) and re-run this one before continuing.**

---

### Task 6: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the Dockerfiles from Tasks 2–3.
- Produces: `ghcr.io/urmomeesak77/ladybug-{php,web}:latest` and `:<sha>`, public. Task 12's `deploy.sh` pulls these by tag.

- [ ] **Step 1: Write the workflow**

Third-party actions are pinned by commit SHA, matching the convention in `.github/workflows/ci.yml`.

```yaml
name: Release

# Only after CI passes on master: a red build must never produce a deployable image.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [master]
  # Manual re-runs, e.g. to rebuild a tag after a base-image security update.
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  images:
    name: Build and push images
    runs-on: ubuntu-latest
    # workflow_run fires on failure too; only ship green builds.
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    permissions:
      contents: read
      # The ONLY credential this workflow needs. No SSH key, no database password and
      # no SMTP password is ever stored as a secret, because deploys are pulled
      # manually from the server rather than pushed from CI.
      packages: write
    strategy:
      matrix:
        include:
          - name: ladybug-php
            dockerfile: deploy/php/Dockerfile
          - name: ladybug-web
            dockerfile: deploy/web/Dockerfile
    steps:
      # workflow_run checks out the branch tip by default, which may already have moved
      # past the commit CI actually validated. Pin to the exact validated SHA so the
      # image tag and its contents genuinely correspond -- rollback depends on it.
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - id: vars
        run: echo "sha=${{ github.event.workflow_run.head_sha || github.sha }}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0

      - uses: docker/login-action@371161bbe7024a29a25c5e19bfcbc0804fe9ad2c # v4.5.2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
        with:
          images: ghcr.io/${{ github.repository_owner }}/${{ matrix.name }}
          # `latest` for convenience, plus the validated commit SHA so deploy.sh can pin
          # an exact build and roll back to it. type=sha is NOT used: it derives from
          # github.sha, which is the branch tip rather than the commit CI validated.
          tags: |
            type=raw,value=latest
            type=raw,value=${{ steps.vars.outputs.sha }}

      - uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
        with:
          # Repo root: both Dockerfiles copy from backend/ or frontend/.
          context: .
          file: ${{ matrix.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          # No build-args: secrets must never enter a layer, since `docker history`
          # is readable by anyone on a public package.
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
```

- [ ] **Step 2: Validate the YAML before pushing**

A workflow that fails to parse produces a `startup_failure` run with zero jobs, which is easy to misread as a billing problem.

```sh
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci(deploy): build and publish production images to GHCR"
git push origin master
```

- [ ] **Step 4: Watch CI, then the release run**

```sh
gh run list --limit 5
gh run watch
```

Expected: `CI` completes green, then `Release` triggers and both matrix jobs succeed.

- [ ] **Step 5: Make the packages public and verify anonymous pull**

The packages default to private. Set both to public in GitHub → Packages → each package → Package settings → Change visibility, then verify from a logged-out client:

```sh
docker logout ghcr.io
docker pull ghcr.io/urmomeesak77/ladybug-php:latest
docker pull ghcr.io/urmomeesak77/ladybug-web:latest
```

Expected: both pull without credentials. **If they do not, the server will need a GHCR token and Task 8's `setup.sh` must add a `docker login` step** — flag it to the reviewer rather than improvising.

- [ ] **Step 6: Confirm no secret entered the image history**

```sh
docker history --no-trunc ghcr.io/urmomeesak77/ladybug-php:latest \
  | grep -iE "password|secret|api[_-]?key" || echo "image history clean"
```

Expected: `image history clean`.

---

### Task 7: Edge nginx configuration

**Files:**
- Create: `deploy/nginx-edge/online-trash.com.conf`

**Interfaces:**
- Consumes: the loopback port `8080` published in Task 4, and `trustProxies` from Task 1.
- Produces: the file Task 15 installs at `/web/nginx/conf.d/online-trash.com.conf`. Task 11 relies on its ACME location for renewal.

- [ ] **Step 1: Write the config**

```nginx
# Apex and www for online-trash.com. Installed at /web/nginx/conf.d/ alongside
# default.conf, which keeps the games.online-trash.com blocks; the apex blocks are
# REMOVED from default.conf when this lands (see DEPLOYMENT.md).
#
# The Ladybug stack is reached exactly as the Thousand game is: proxy_pass to a
# loopback-published port through the Docker host gateway. `extra_hosts:
# host.docker.internal:host-gateway` is already declared in /web/nginx/docker-compose.yml.

server {
    listen 80;
    listen [::]:80;
    server_name online-trash.com www.online-trash.com;

    # certbot's http-01 challenge is fetched over plain HTTP and must not be redirected
    # away. Textual order is NOT what makes this work: a `return` placed directly in the
    # server{} context runs in the server-rewrite phase, which precedes location matching
    # entirely, so it would fire unconditionally and this location would never be reached.
    # The redirect therefore lives in `location /` below, so the challenge prefix -- a
    # longer, more specific match -- wins. Verified: server-level return yields 301 and no
    # token; the form below yields 200 and the token.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://online-trash.com$request_uri;
    }
}

# www -> apex, so there is exactly one canonical origin. This matters beyond tidiness:
# SESSION_DOMAIN and SANCTUM_STATEFUL_DOMAINS are pinned, and a session started on one
# host would not be presented on the other.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name www.online-trash.com;

    ssl_certificate /etc/letsencrypt/live/online-trash.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/online-trash.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    return 301 https://online-trash.com$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name online-trash.com;

    ssl_certificate /etc/letsencrypt/live/online-trash.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/online-trash.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # No includeSubDomains: games.online-trash.com is a sibling on the same certificate
    # but is not managed by this file, and the directive would force HTTPS on it for a
    # year with no way to walk it back quickly.
    add_header Strict-Transport-Security "max-age=31536000" always;

    # 10 MiB image cap (CreatePostRequest) plus multipart overhead. Without this nginx
    # would reject uploads with 413 long before PHP saw them.
    client_max_body_size 12M;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://host.docker.internal:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # Laravel reads this to build https URLs and to sign/validate e-mail
        # verification links. Requires trustProxies (backend/bootstrap/app.php).
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

- [ ] **Step 2: Validate the syntax without a live server**

The real certs do not exist locally, so generate a throwaway pair and test against a copy that points at them.

```sh
SCRATCH="$HOME/AppData/Local/Temp/claude/nginx-edge-test"
mkdir -p "$SCRATCH/certs" "$SCRATCH/conf"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$SCRATCH/certs/privkey.pem" -out "$SCRATCH/certs/fullchain.pem" \
  -subj "/CN=online-trash.com" 2>/dev/null
sed 's|/etc/letsencrypt/live/online-trash.com|/certs|' \
  deploy/nginx-edge/online-trash.com.conf > "$SCRATCH/conf/online-trash.com.conf"

docker run --rm \
  -v "$SCRATCH/conf:/etc/nginx/conf.d:ro" \
  -v "$SCRATCH/certs:/certs:ro" \
  nginx:latest nginx -t
```

Expected: `syntax is ok` and `test is successful`.

- [ ] **Step 3: Clean up and commit**

```bash
rm -rf "$SCRATCH"
git add deploy/nginx-edge/
git commit -m "feat(deploy): edge nginx config for the apex domain"
```

---

### Task 8: Server setup and deploy scripts

**Files:**
- Create: `deploy/setup.sh`, `deploy/deploy.sh`

**Interfaces:**
- Produces: `setup.sh` (idempotent one-time prep, generates every secret) and `deploy.sh <tag>` (pull, migrate, health-check). Tasks 11–12 run them; Task 17 re-runs `setup.sh` on a bare machine.

- [ ] **Step 1: Write `deploy/setup.sh`**

```bash
#!/usr/bin/env bash
# One-time (idempotent) preparation of the Ladybug production host.
#
# Generates every secret locally and prints them ONCE. Nothing here is ever committed:
# the repository and the container images are both public.
#
# Safe to re-run: existing secrets are preserved, so this doubles as the first step of
# the disaster-recovery path (docs/DEPLOYMENT.md) on a freshly provisioned VPS.
set -euo pipefail

ROOT=/web/online-trash.com
REPO_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Swap"
# The box has 960 MiB and shipped with no swap, which turns any transient spike --
# a large image decode in GD, a MySQL query burst -- into an OOM kill instead of a
# slowdown. 2 GiB with a low swappiness: present as a safety net, not as routine paging.
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
grep -q '^vm.swappiness' /etc/sysctl.conf || {
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    sysctl -p >/dev/null
}

echo "==> Docker log rotation"
# Unbounded json-file logs are the classic way to fill a 20 GiB disk.
if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
    systemctl restart docker
fi

echo "==> Packages"
# lftp does incremental FTPS mirroring for the media backup; curl alone cannot.
command -v lftp >/dev/null || { apt-get update -qq && apt-get install -y -qq lftp; }

echo "==> Directories"
mkdir -p "$ROOT"/data/{mysql,storage/app/public,backups}
# php-fpm runs as www-data (uid 33) inside the container.
chown -R 33:33 "$ROOT/data/storage"

echo "==> Stack files"
cp "$REPO_DEPLOY/docker-compose.prod.yml" "$ROOT/docker-compose.yml"
cp "$REPO_DEPLOY/deploy.sh" "$REPO_DEPLOY/backup.sh" "$REPO_DEPLOY/restore.sh" "$ROOT/"
chmod +x "$ROOT"/{deploy,backup,restore}.sh

# A generator, not a chooser: 32 alphanumerics avoids quoting hazards in .env, MySQL
# and shell alike, while staying far beyond guessable.
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }

echo "==> Secrets"
if [ ! -f "$ROOT/.env" ]; then
    cat > "$ROOT/.env" <<ENV
LADYBUG_TAG=latest
MYSQL_ROOT_PASSWORD=$(gen)
MYSQL_PASSWORD=$(gen)
ENV
    chmod 600 "$ROOT/.env"
    echo "    generated $ROOT/.env"
else
    echo "    $ROOT/.env exists, left untouched"
fi

if [ ! -f "$ROOT/backend.env" ]; then
    cp "$REPO_DEPLOY/backend.env.example" "$ROOT/backend.env"
    APP_KEY="base64:$(openssl rand -base64 32)"
    DB_PASSWORD="$(grep '^MYSQL_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)"
    sed -i "s|^APP_KEY=.*|APP_KEY=${APP_KEY}|" "$ROOT/backend.env"
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ROOT/backend.env"
    chmod 600 "$ROOT/backend.env"
    echo "    generated $ROOT/backend.env"
    echo "    !! MAIL_PASSWORD is still empty -- copy it from the dev backend/.env"
else
    echo "    $ROOT/backend.env exists, left untouched"
fi

if [ ! -f /root/.ladybug-backup-pass ]; then
    gen > /root/.ladybug-backup-pass
    chmod 600 /root/.ladybug-backup-pass
    echo "    generated /root/.ladybug-backup-pass"
fi

if [ ! -f /root/.ladybug-ftp ]; then
    cat > /root/.ladybug-ftp <<'ENV'
# Dedicated Zone.eu FTPS user for off-box backups, chrooted to its own root.
# Connect by HOSTNAME: the certificate is *.tll07.zoneas.eu and the bare IP fails
# verification. SINGLE-QUOTE the password -- it contains / = ? and + characters.
FTP_HOST=sn-69-18.tll07.zoneas.eu
FTP_USER=
FTP_PASS=''
ENV
    chmod 600 /root/.ladybug-ftp
    echo "    created /root/.ladybug-ftp -- fill in FTP_USER and FTP_PASS"
fi

cat <<SUMMARY

==================== SAVE THESE NOW ====================
MySQL root password : $(grep '^MYSQL_ROOT_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)
MySQL app password  : $(grep '^MYSQL_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)
Backup passphrase   : $(cat /root/.ladybug-backup-pass)

The backup passphrase is the one secret that CANNOT be recovered from the
backups -- it is what decrypts them. Put it in a password manager now.
========================================================

Remaining manual steps:
  1. Fill MAIL_PASSWORD in $ROOT/backend.env (from the dev backend/.env)
  2. Fill FTP_USER and FTP_PASS in /root/.ladybug-ftp
SUMMARY
```

- [ ] **Step 2: Write `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Pull a released image tag and roll the stack onto it.
#
#   ./deploy.sh              -> latest
#   ./deploy.sh <git-sha>    -> that exact build (this is also how you roll back;
#                               every release is tagged with its commit SHA)
set -euo pipefail

ROOT=/web/online-trash.com
TAG="${1:-latest}"
cd "$ROOT"

echo "==> Deploying tag: $TAG"
sed -i "s|^LADYBUG_TAG=.*|LADYBUG_TAG=${TAG}|" .env

docker compose pull
docker compose up -d --remove-orphans

# Migrations run against the NEW image, after it is up, so the schema matches the code
# that will serve requests. --force is required: artisan refuses to migrate in
# production interactively, and there is no TTY here.
echo "==> Migrating"
docker compose exec -T ladybug-php php artisan migrate --force

echo "==> Health check"
for i in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
        echo "    healthy after ${i}s"
        docker compose ps
        exit 0
    fi
    sleep 1
done

echo "    FAILED -- stack did not answer /api/health within 20s" >&2
docker compose ps >&2
docker compose logs --tail=50 >&2
exit 1
```

- [ ] **Step 3: Syntax-check both scripts**

```sh
bash -n deploy/setup.sh && bash -n deploy/deploy.sh && echo "syntax OK"
docker run --rm -v "${PWD}/deploy:/mnt" koalaman/shellcheck:stable \
  --severity=warning /mnt/setup.sh /mnt/deploy.sh || echo "review shellcheck findings"
```

Expected: `syntax OK`. Address any shellcheck warning at `warning` severity or above; if the shellcheck image is unavailable, `bash -n` alone is acceptable and should be reported as such.

- [ ] **Step 4: Commit**

```bash
git add deploy/setup.sh deploy/deploy.sh
git commit -m "feat(deploy): server setup and deploy scripts"
```

---

### Task 9: Backup and restore scripts

**Files:**
- Create: `deploy/backup.sh`, `deploy/restore.sh`

**Interfaces:**
- Consumes: `/root/.ladybug-ftp` and `/root/.ladybug-backup-pass` from Task 8.
- Produces: `/db/`, `/env/` and `/media/` on the FTPS host (the backup user's own chrooted root). Task 16 schedules `backup.sh`; Task 17 exercises `restore.sh`.

- [ ] **Step 1: Write `deploy/backup.sh`**

```bash
#!/usr/bin/env bash
# Nightly off-box backup to the Zone.eu hosting account over explicit FTPS.
#
# A VPS reset wipes the whole disk -- there is no detachable volume -- so this is the
# only thing standing between a rebuild and permanent data loss.
#
# TWO RULES, both learned from surveying the target:
#   1. Connect by HOSTNAME. The certificate is *.tll07.zoneas.eu; the bare IP fails
#      verification. The server also refuses plaintext (530), hence --ssl-reqd.
#   2. The backup user is chrooted to its own root, so /db, /env and /media here are
#      NOT the hosting account's root -- it cannot see htdocs or the other content on
#      that account. Paths stay absolute and --delete is still never used: the chroot
#      is the guard, this is the defence in depth behind it.
set -euo pipefail

ROOT=/web/online-trash.com
STAMP="$(date +%Y%m%d-%H%M)"
KEEP=5

# shellcheck source=/dev/null
. /root/.ladybug-ftp
PASSPHRASE_FILE=/root/.ladybug-backup-pass
FTP_URL="ftp://${FTP_HOST}"
CURL_OPTS=(--ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --silent --show-error --fail)

# Run a snippet inside the booted app. `php artisan tinker` does NOT exist here:
# laravel/tinker is not a dependency of this project, and the production image ships
# --no-dev regardless. Booting the kernel is what Artisan itself does.
lb_php() {
    docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
'"$1"
}

cd "$ROOT"

echo "==> Dumping database"
DUMP="data/backups/trashdb-${STAMP}.sql.gz.gpg"
# --single-transaction takes a consistent snapshot without locking readers.
# Encrypted because the dump carries user e-mail addresses and bcrypt hashes, and it
# lands on a shared account that has a web docroot on it.
docker compose exec -T ladybug-mysql \
    mysqldump --single-transaction --routines --no-tablespaces \
        -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" trashdb \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" -o "$DUMP"

echo "==> Uploading database dump"
curl "${CURL_OPTS[@]}" -T "$DUMP" "${FTP_URL}/db/$(basename "$DUMP")"

echo "==> Uploading env bundle"
# Both env files together: backend.env holds APP_KEY and the app DB password, .env
# holds the MySQL root password. Without these a restored dump is unusable.
ENVBUNDLE="data/backups/env-${STAMP}.tar.gz.gpg"
tar -czf - backend.env .env \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" -o "$ENVBUNDLE"
curl "${CURL_OPTS[@]}" -T "$ENVBUNDLE" "${FTP_URL}/env/$(basename "$ENVBUNDLE")"

echo "==> Mirroring media"
# Incremental: only files whose size or timestamp changed. Media variants are
# content-addressed and never rewritten, so after the first seed the delta is tiny.
# NOTE the explicit absolute target and the absence of --delete: see rule 2 above.
lftp -u "${FTP_USER},${FTP_PASS}" \
     -e "set ftp:ssl-force true; set ssl:verify-certificate true; \
         mirror -R --only-newer --no-perms data/storage/app/public /media; \
         bye" \
     "${FTP_HOST}"

echo "==> Pruning to the ${KEEP} most recent"
prune_remote() {
    local dir="$1"
    # Filenames are timestamped, so lexical sort is chronological.
    curl "${CURL_OPTS[@]}" --list-only "${FTP_URL}/${dir}/" \
      | sort \
      | head -n -"${KEEP}" \
      | while read -r old; do
            [ -n "$old" ] || continue
            echo "    removing ${dir}/${old}"
            curl "${CURL_OPTS[@]}" -Q "DELE /${dir}/${old}" "${FTP_URL}/${dir}/" -o /dev/null
        done
}
prune_remote db
prune_remote env
ls -1t data/backups/trashdb-*.sql.gz.gpg 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t data/backups/env-*.tar.gz.gpg     2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "==> Disk check"
USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$USED" -gt 80 ]; then
    lb_php "Mail::raw('online-trash.com root filesystem is ${USED}% full.', fn (\$m) =>
        \$m->to('urmo.meesak@gmail.com')->subject('[ladybug] disk ${USED}% full'));"
fi

echo "==> Backup complete: ${STAMP}"
```

- [ ] **Step 2: Write `deploy/restore.sh`**

```bash
#!/usr/bin/env bash
# Disaster recovery: rebuild application state from the off-box backups.
#
# Assumes setup.sh has already run and the stack is up (deploy.sh). Run on a freshly
# provisioned VPS this is the whole recovery path; run on the live box it is a
# rollback to last night.
#
#   ./restore.sh            -> newest remote dump
#   ./restore.sh <filename> -> a specific dump from /db/
set -euo pipefail

ROOT=/web/online-trash.com
# shellcheck source=/dev/null
. /root/.ladybug-ftp
PASSPHRASE_FILE=/root/.ladybug-backup-pass
FTP_URL="ftp://${FTP_HOST}"
CURL_OPTS=(--ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --silent --show-error --fail)

cd "$ROOT"

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
    DUMP="$(curl "${CURL_OPTS[@]}" --list-only "${FTP_URL}/db/" | sort | tail -1)"
fi
echo "==> Restoring from: $DUMP"

echo "==> Downloading"
curl "${CURL_OPTS[@]}" "${FTP_URL}/db/${DUMP}" -o "/tmp/${DUMP}"

echo "==> Importing"
gpg --batch --yes --decrypt --passphrase-file "$PASSPHRASE_FILE" "/tmp/${DUMP}" \
  | gunzip \
  | docker compose exec -T ladybug-mysql \
        mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" trashdb
rm -f "/tmp/${DUMP}"

echo "==> Mirroring media back down"
lftp -u "${FTP_USER},${FTP_PASS}" \
     -e "set ftp:ssl-force true; set ssl:verify-certificate true; \
         mirror --only-newer --no-perms /media data/storage/app/public; \
         bye" \
     "${FTP_HOST}"
chown -R 33:33 data/storage

echo "==> Verifying"
# Not `artisan tinker` -- see backup.sh for why that command does not exist here.
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo "posts=", \App\Models\Trashpost::count(),
     " users=", \App\Models\User::count(),
     " comments=", \App\Models\Comment::count(), PHP_EOL;
'
curl -fsS http://127.0.0.1:8080/api/health; echo

echo "==> Restore complete"
```

- [ ] **Step 3: Syntax-check**

```sh
bash -n deploy/backup.sh && bash -n deploy/restore.sh && echo "syntax OK"
docker run --rm -v "${PWD}/deploy:/mnt" koalaman/shellcheck:stable \
  --severity=warning /mnt/backup.sh /mnt/restore.sh || echo "review shellcheck findings"
```

Expected: `syntax OK`.

- [ ] **Step 4: Confirm no credential is embedded**

```sh
grep -nE "2Asda|d29032|FTP_PASS=[^\"]|MYSQL_ROOT_PASSWORD=[A-Za-z0-9]" deploy/*.sh \
  || echo "scripts are credential-free"
```

Expected: `scripts are credential-free` — every secret is read from a root-only file at run time.

- [ ] **Step 5: Commit**

```bash
git add deploy/backup.sh deploy/restore.sh
git commit -m "feat(deploy): encrypted off-box backup and restore scripts"
```

---

### Task 10: Deployment documentation

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Modify: `README.md` (link it), `CLAUDE.md` (note the deployment surface)

**Interfaces:**
- Consumes: everything above.
- Produces: the runbook Task 17 executes verbatim. If the rehearsal cannot be completed from this document alone, the document is wrong.

- [ ] **Step 1: Write `docs/DEPLOYMENT.md`**

Cover exactly these sections, drawing values from the design spec:

1. **Architecture** — the topology diagram from the spec §1, and why the stack owns its own nginx.
2. **Prerequisites** — SSH root access; images public on GHCR; DNS already pointing at `217.146.72.141`.
3. **First-time server setup** — clone the repo to `/root/ladybug`, run `deploy/setup.sh`, save the printed secrets, fill `MAIL_PASSWORD` and the two FTP values.
4. **Edge nginx** — install `online-trash.com.conf`, remove the apex blocks from `default.conf`, `docker exec nginx-web-1 nginx -t`, then `nginx -s reload`.
5. **Releasing** — CI publishes on green master; `./deploy.sh` to take latest; `./deploy.sh <sha>` to pin or roll back.
6. **Backups** — what is stored where, the 5-item retention, and the FTPS rules: connect by hostname not IP, the backup user is chrooted to its own root, and the password needs single-quoting.
7. **Disaster recovery runbook** — the numbered list in Step 2 below.
8. **Growing the disk** — `growpart /dev/vda 1 && resize2fs /dev/vda1`, non-destructive, `vda1` is the last partition.
9. **TLS renewal** — the cron, and how to verify expiry.
10. **Troubleshooting** — `docker compose logs`, the RAM budget table from spec §5, and `free -h` / `docker stats` as the first checks.

- [ ] **Step 2: Write the DR runbook precisely**

```markdown
## Disaster recovery: rebuilding on a fresh VPS

You need three things that exist nowhere else: the backup passphrase (password
manager), the FTP credentials, and SSH access. Everything else -- code, images,
configuration -- is reproducible from GitHub and GHCR.

1. Provision Ubuntu 24.04, point DNS at the new IP.
2. Install Docker, then `git clone https://github.com/urmomeesak77/ladybug.git /root/ladybug`.
3. Write `/root/.ladybug-backup-pass` (from the password manager) and
   `/root/.ladybug-ftp` (host, user, pass), both `chmod 600`.
4. `bash /root/ladybug/deploy/setup.sh`
5. Recover the previous secrets rather than using the freshly generated ones:
   download the newest `/env/env-*.tar.gz.gpg`, decrypt it, and put
   `backend.env` and `.env` in `/web/online-trash.com/`. **The old APP_KEY matters:
   a new one invalidates every existing session cookie.**
6. `cd /web/online-trash.com && ./deploy.sh latest`
7. `./restore.sh` -- imports the newest dump and mirrors the media back down.
8. Install the edge nginx config and reissue certificates with certbot.
9. Verify with the checklist in "Post-deploy verification".
```

- [ ] **Step 3: Link it from `README.md` and note it in `CLAUDE.md`**

Add a `## Deployment` section to `README.md` pointing at `docs/DEPLOYMENT.md`, and add a line to the `CLAUDE.md` "Supporting files" list:

```markdown
- **`deploy/`** — production deployment: Dockerfiles for the php-fpm and nginx+SPA
  images, the prod Compose stack, edge nginx config, and the setup/deploy/backup/
  restore scripts. Runbook in `docs/DEPLOYMENT.md`.
```

- [ ] **Step 4: Verify every command in the doc is real**

Re-read `docs/DEPLOYMENT.md` against `deploy/`. Each referenced path, script name, service name and flag must exist. Confirm specifically: service names are `ladybug-mysql`/`ladybug-php`/`ladybug-web`; the port is `127.0.0.1:8080`; the FTP host is used by hostname everywhere.

- [ ] **Step 5: Commit and push**

```bash
git add docs/DEPLOYMENT.md README.md CLAUDE.md
git commit -m "docs(deploy): deployment runbook and disaster recovery procedure"
git push origin master
```

---

# Phase B — Server work

This phase changes production. Every task is reversible until Task 15.

---

### Task 11: Prepare the server and repair TLS renewal

**Runs on:** `root@online-trash.com`

**Interfaces:**
- Consumes: `deploy/setup.sh` (Task 8), `deploy/nginx-edge/online-trash.com.conf` (Task 7).
- Produces: swap, log rotation, directories, secrets, and a working certbot renewal. Task 12 depends on the directories and secrets.

- [ ] **Step 1: Clone the repo and run setup**

```sh
ssh root@online-trash.com
git clone https://github.com/urmomeesak77/ladybug.git /root/ladybug
bash /root/ladybug/deploy/setup.sh
```

Expected: the `SAVE THESE NOW` block prints three secrets. **Copy them into a password manager before continuing** — the backup passphrase in particular cannot be recovered later.

- [ ] **Step 2: Fill the two remaining secrets**

```sh
# MAIL_PASSWORD: the value from the dev backend/.env (smtp.zone.eu, no-reply@online-trash.com)
nano /web/online-trash.com/backend.env
# FTP_USER / FTP_PASS for the Zone hosting account
nano /root/.ladybug-ftp
```

- [ ] **Step 3: Verify the prep took**

```sh
free -h                       # Swap: 2.0Gi
cat /proc/sys/vm/swappiness   # 10
cat /etc/docker/daemon.json   # log-opts present
command -v lftp
ls -la /web/online-trash.com/
stat -c '%a %n' /web/online-trash.com/.env /web/online-trash.com/backend.env \
                /root/.ladybug-ftp /root/.ladybug-backup-pass
```

Expected: 2 GiB swap active, swappiness 10, lftp present, the `data/` tree in place, and
`600` on `.env`, `/root/.ladybug-ftp` and `/root/.ladybug-backup-pass`, with
`640 root:www-data` on `backend.env` (deliberately — uid 33 must read it).

**Actually check these, do not assume.** (2026-07-29: found `/root/.ladybug-backup-pass`
at **644** — world-readable to every account on the box, and it is the one secret that
cannot be recovered from the backups.) The cause was that `setup.sh` originally chmod'd
only inside the `if [ ! -f ]` block that *creates* each file, so any secret that predated
the script kept its umask mode. `setup.sh` now re-asserts all four modes on every run, so
a re-run repairs this; the check above is what catches it if it ever regresses.

- [ ] **Step 4: Verify the FTPS target end to end**

```sh
. /root/.ladybug-ftp
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/" \
  -Q "MKD /db" -Q "MKD /env" -Q "MKD /media" -o /dev/null
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/"
```

Expected: `db`, `env` and `media` listed, and **nothing else** — the user is chrooted, so its root contains only what we put there. If the connection fails with a certificate error, you used the IP instead of the hostname; if it fails to authenticate, the password in `/root/.ladybug-ftp` is not single-quoted.

Then confirm `lftp` can authenticate too, since it parses the password differently from curl:

```sh
lftp -u "${FTP_USER},${FTP_PASS}" \
     -e "set ftp:ssl-force true; set ssl:verify-certificate true; ls; bye" "${FTP_HOST}"
```

Expected: the same three directories. (Verified working against this account on 2026-07-28, including certificate verification.)

- [ ] **Step 5: Fix the ACME challenge path**

Renewal is broken for two reasons; this is the first.

**The subtlety that makes this worth doing carefully.** The games `:80` block already
*has* an ACME location — and it does not work. nginx evaluates a `return` placed
directly in the `server{}` context during the **server-rewrite phase**, which runs
*before* location matching, so a server-level `return 301` fires unconditionally and
any sibling `location` is never reached. Verified empirically:

```
location /.well-known/acme-challenge/ { root /var/www/certbot; }
return 301 https://example.com$request_uri;      →  301, token NOT served

location /.well-known/acme-challenge/ { root /var/www/certbot; }
location / { return 301 https://example.com$request_uri; }
                                                  →  200, token served
```

Renewal has been limping only because Let's Encrypt follows the HTTP→HTTPS redirect
into the `:443` block's copy of the location. Do not rely on that.

So in `/web/nginx/conf.d/default.conf`, for the **games `:80` block**, move its
existing `return 301` inside a `location /`:

```nginx
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
```

**The apex blocks need the same fix, now — not in Task 15.** (Corrected 2026-07-29
against the live box.) The claim that renewal "limps" via the `:443` copy of the
location holds only for **games**, whose `:443` block does have one. The apex `:443`
block has **no** `acme-challenge` location at all, so `online-trash.com` and
`www.online-trash.com` were not limping — they were failing outright. Measured, before
the fix:

```
Identifier: online-trash.com      Type: unauthorized   Detail: ... 404
Identifier: www.online-trash.com  Type: unauthorized   Detail: ... 404
```

Waiting for Task 15 to replace those blocks would leave renewal broken in the
meantime, so apply the same treatment to the apex `:80` block (redirect into
`location /`, plus the challenge location) **and** add the challenge location to the
apex `:443` block. Task 15's `deploy/nginx-edge/online-trash.com.conf` already carries
both, so this interim edit is simply superseded, not undone.

Then:

```sh
docker exec nginx-web-1 nginx -t && docker exec nginx-web-1 nginx -s reload
# NOTE the path: the directive is `root`, not `alias`, so nginx appends the FULL URI
# to it and the file must live at <webroot>/.well-known/acme-challenge/. Writing the
# probe to the top of the webroot (as an earlier draft of this step did) can only ever
# 404, which looks exactly like the redirect bug this step is meant to prove is fixed.
mkdir -p /web/nginx/certbot/www/.well-known/acme-challenge
echo ok > /web/nginx/certbot/www/.well-known/acme-challenge/probe.txt
curl -s http://games.online-trash.com/.well-known/acme-challenge/probe.txt
curl -s http://online-trash.com/.well-known/acme-challenge/probe.txt
rm /web/nginx/certbot/www/.well-known/acme-challenge/probe.txt
```

Expected: `ok` from **both**, served over plain HTTP **without** being redirected. If you
get an HTML redirect page instead, the `return` is still at server level.

- [ ] **Step 6: Repair and schedule renewal**

The certbot container has been `Exited (1)` for weeks and root has no crontab — the second reason. Test a dry run, then schedule:

**`-T` and `--non-interactive` are mandatory, not tidiness.** (Corrected 2026-07-29.)
`docker compose run` allocates a TTY by default; with no TTY attached — a
non-interactive SSH command, and **cron** — certbot hangs indefinitely right after
`Processing /etc/letsencrypt/renewal/...` instead of failing. Observed twice: the
container sat running until killed by hand. Scheduled without `-T`, renewal would
silently never complete and the cert would simply expire. `timeout` bounds the damage
if it ever wedges anyway.

```sh
cd /web/nginx
timeout 420 docker compose run --rm -T certbot renew --webroot -w /var/www/certbot --dry-run --non-interactive
```

Expected: `Congratulations, all simulated renewals succeeded`. Allow it a few minutes —
the Let's Encrypt **staging** endpoint used by `--dry-run` is markedly slower than
production and a 180s budget was not always enough.

Install the entry non-interactively (`crontab -e` needs an editor and a TTY):

```sh
{ crontab -l 2>/dev/null | grep -v 'certbot renew' || true
  echo '# TLS renewal: certbot no-ops until the cert is inside its 30-day window.'
  echo '17 3 * * * cd /web/nginx && timeout 600 docker compose run --rm -T certbot renew --webroot -w /var/www/certbot --quiet --non-interactive && docker exec nginx-web-1 nginx -s reload'
} | crontab -
crontab -l
```

- [ ] **Step 7: Confirm the current expiry**

```sh
docker run --rm -v /web/nginx/certbot/conf:/etc/letsencrypt --entrypoint openssl \
  certbot/certbot x509 -in /etc/letsencrypt/live/online-trash.com/fullchain.pem -noout -dates
```

Expected: `notAfter=Sep 2 ... 2026`. Renewal is now scheduled well ahead of it.

---

### Task 12: First deploy against an empty database

**Runs on:** `root@online-trash.com`

**Interfaces:**
- Consumes: Task 11's prepared host, Task 6's GHCR images.
- Produces: a running stack on `127.0.0.1:8080` with an empty, migrated schema. Task 13 loads data into it.

- [ ] **Step 1: Deploy**

```sh
cd /web/online-trash.com
./deploy.sh latest
```

Expected: images pull, three services start, migrations run, `healthy after Ns`, and `docker compose ps` shows all three up with `ladybug-mysql` healthy.

- [ ] **Step 2: Verify the stack over the edge network**

**Not `127.0.0.1:8080`.** (Corrected 2026-07-29.) This step predates the fix in
`d016495`: the stack publishes **no host port at all** any more, and `ladybug-web` is
reached by name over the shared external `nginx_default` network. A host-side curl to
a loopback port now tests nothing and simply fails. Exercise the same path the edge
actually uses:

```sh
docker run --rm --network nginx_default curlimages/curl:latest -sS http://ladybug-web/api/health; echo
docker run --rm --network nginx_default curlimages/curl:latest -sS http://ladybug-web/api/posts; echo
docker run --rm --network nginx_default curlimages/curl:latest -sS -o /dev/null -w '%{http_code}\n' http://ladybug-web/
```

Expected: `{"status":"ok"}`, an empty feed envelope (`{"data":[]}`), and `200` for the
SPA shell.

- [ ] **Step 3: Verify production hardening on the real host**

```sh
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo config("app.env"), " debug=", var_export(config("app.debug"), true), PHP_EOL;
echo config("app.url"), PHP_EOL;
echo DB::selectOne("select current_user() u")->u, PHP_EOL;
'
# Independent cross-check with shipped commands.
docker compose exec -T ladybug-php php artisan about --json | head -c 300; echo
docker compose exec -T ladybug-php php artisan db:show | head -20
# The database must not be reachable from outside the compose network.
ss -ltnp | grep -E '3306|8080' || echo "  none listening - correct"
# Only ladybug-web may join the edge network; php and mysql must not appear here.
docker network inspect nginx_default -f '{{range .Containers}}{{.Name}}{{println}}{{end}}'
```

Expected: `production debug=false`; `ladybug@%`; `https://online-trash.com`; **nothing**
listening on either port (corrected 2026-07-29 — with `d016495` there is no published
port, so the old "only `127.0.0.1:8080`" expectation is now a failure signal); and only
`nginx-web-1` plus `online-trashcom-ladybug-web-1` attached to `nginx_default`.

**Chaining several `docker compose exec -T` calls in one heredoc-fed script:** append
`</dev/null` to each. `exec -T` forwards stdin to the container, so the first call
swallows the remainder of the script and every later command silently never runs —
which reads as a clean pass.

`php artisan db:show` ends with `The "intl" PHP extension is required` on this image.
That is the diagnostic's own number formatting, not the app: no application code uses
`Number::`/`NumberFormatter`, and `ext-intl` is not in `composer.json`. The values it
prints above the error are still valid.

- [ ] **Step 4: Check the memory budget**

```sh
docker stats --no-stream
free -h
```

Expected: total container usage broadly matching spec §5 (~570 MiB for the three new containers), with free memory plus swap comfortably positive. **If MySQL alone exceeds ~350 MiB, revisit the tuning flags before loading data.**

---

### Task 13: Migrate the database and media

**Runs on:** the dev box (transfer) and the server (import).

**Interfaces:**
- Consumes: the running stack from Task 12.
- Produces: production carrying the real corpus. Task 14 verifies it.

- [ ] **Step 1: Dump the dev database**

On the dev box:

```powershell
pwsh scripts/backup-db.ps1
```

Then locate the newest dump under `C:\docker_permanent\ladybug-backups` and gzip it.

- [ ] **Step 2: Transfer and import the dump**

```sh
scp "/c/docker_permanent/ladybug-backups/<newest>.sql.gz" root@online-trash.com:/tmp/
```

On the server:

```sh
cd /web/online-trash.com
gunzip -c /tmp/<newest>.sql.gz \
  | docker compose exec -T ladybug-mysql \
      mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" trashdb
rm /tmp/<newest>.sql.gz
```

- [ ] **Step 3: Stream the media across**

There is no `rsync` on the Windows host, so pipe tar over SSH. Only `app/public` moves — the rest of the storage tree is local dev state (sessions, cache, logs) and was created fresh by `setup.sh`.

```sh
tar -cf - -C "/c/docker_permanent/ladybug-storage/app/public" . \
  | ssh root@online-trash.com 'tar -xf - -C /web/online-trash.com/data/storage/app/public'
```

This moves ~1.3 GB and will take a while. On completion, on the server:

```sh
chown -R 33:33 /web/online-trash.com/data/storage
du -sh /web/online-trash.com/data/storage/app/public
df -h /
```

Expected: ~1.3 GB transferred; the root filesystem still well under 80%.

- [ ] **Step 4: Verify the data landed intact**

```sh
cd /web/online-trash.com
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo "posts=", \App\Models\Trashpost::count(),
     " users=", \App\Models\User::count(),
     " comments=", \App\Models\Comment::count(), PHP_EOL;
'
```

Compare against the same counts on the dev box. Then confirm a real post's media exists on disk:

```sh
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo \App\Models\Trashpost::whereNotNull("file")->value("hash"), PHP_EOL;
' </dev/null
docker run --rm --network nginx_default curlimages/curl:latest \
  -sS -o /dev/null -w '%{http_code}\n' "http://ladybug-web/api/posts/<that-hash>"
```

Expected: matching counts, and `200` from the post endpoint.

(Corrected 2026-07-29: the column is **`file`**, not `image` — `whereNotNull("image")`
throws `Unknown column 'image'`. And the endpoint is reached over `nginx_default`, per
the Task 12 Step 2 correction.)

- [ ] **Step 5: Run any pending migrations against the imported schema**

```sh
docker compose exec -T ladybug-php php artisan migrate --force
```

Expected: `Nothing to migrate`, or a clean run if the dev dump predates a migration.

---

### Task 14: Smoke-test privately, then prune dev accounts

**Runs on:** the dev box (tunnel) and the server.

**Interfaces:**
- Consumes: the loaded stack from Task 13.
- Produces: a stack known-good before any public traffic. Task 15 exposes it.

- [ ] **Step 1: Open a tunnel from the dev box**

```sh
ssh -L 8080:127.0.0.1:8080 root@online-trash.com
```

Leave it open and browse `http://localhost:8080` in a browser.

- [ ] **Step 2: Walk the read paths**

Confirm: the feed renders with real memes and paginates on scroll; a permalink `/posts/{hash}` loads; images render at the right sizes; a YouTube post embeds; comments appear on a post that has them.

Media URLs will point at `https://online-trash.com/storage/...` because `APP_URL` is correct for production, so **images may not load through the tunnel**. That is expected, not a defect. Verify media separately on the server:

```sh
curl -fsS -D- -o /dev/null "http://127.0.0.1:8080/storage/<a real media path>" \
  | grep -iE "HTTP/|cache-control"
```

Expected: `200` and `Cache-Control: public, immutable`.

- [ ] **Step 3: Prune the dev accounts**

Migrating everything carried dev e-mail addresses and password hashes into production. List them and delete what does not belong:

```sh
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
foreach (\App\Models\User::orderBy("id")->get(["id","name","email","role"]) as $u) {
    echo $u->id, "  ", $u->email, "  ", $u->role, PHP_EOL;
}
'
```

Delete each test account by e-mail, and confirm the intended superuser survives:

```sh
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo \App\Models\User::where("email", "<test@example.com>")->delete(), " deleted", PHP_EOL;
'
docker compose exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
foreach (\App\Models\User::where("role", "superuser")->get(["email"]) as $u) {
    echo $u->email, PHP_EOL;
}
'
```

Their uploads are orphaned rather than cascaded (`trashposts.user_id` is `nullOnDelete`), so no memes are lost. If no superuser exists, create one: `php artisan make:superuser`.

- [ ] **Step 4: Close the tunnel and report**

Report to the reviewer which paths were verified. **Do not proceed to Task 15 if anything above failed** — after the edge flip, failures are public.

---

### Task 15: Flip the edge to the live stack

**Runs on:** `root@online-trash.com`. This is the task that makes the site public.

**Interfaces:**
- Consumes: Task 7's config and the verified stack.
- Produces: `https://online-trash.com` serving Ladybug.

- [ ] **Step 1: Back up the current edge config**

```sh
cp /web/nginx/conf.d/default.conf /web/nginx/conf.d/default.conf.pre-ladybug
```

This file is the rollback.

- [ ] **Step 2: Install the new config and remove the apex blocks**

```sh
cp /root/ladybug/deploy/nginx-edge/online-trash.com.conf /web/nginx/conf.d/
nano /web/nginx/conf.d/default.conf
```

Delete the two apex server blocks (`server_name online-trash.com www.online-trash.com;` on `:80`, and the matching `:443` block). **Keep** the `map $http_upgrade $connection_upgrade` block at the top — the games `/thousand/` proxy needs it — and keep both games blocks.

- [ ] **Step 3: Test and reload**

```sh
docker exec nginx-web-1 nginx -t
docker exec nginx-web-1 nginx -s reload
```

Expected: `test is successful`. **If `nginx -t` fails, do not reload** — fix the config first; the running server is still serving correctly.

- [ ] **Step 4: Verify the public site**

From the dev box:

```sh
curl -fsS https://online-trash.com/api/health; echo
curl -fsS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://online-trash.com/
curl -fsS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.online-trash.com/
curl -fsS https://online-trash.com/ | head -c 100; echo
curl -fsS -D- -o /dev/null https://online-trash.com/ | grep -i strict-transport
# The games subdomain must be untouched.
curl -fsS -o /dev/null -w '%{http_code}\n' https://games.online-trash.com/thousand/
```

Expected: `{"status":"ok"}`; `301` to `https://online-trash.com/`; `301` from www to apex; the SPA shell; an HSTS header; and `200` for Thousand.

- [ ] **Step 5: Verify the proxy headers reached Laravel**

This is what Task 1 was for.

```sh
curl -fsS https://online-trash.com/api/posts | head -c 400; echo
```

Expected: media URLs in the JSON begin with **`https://online-trash.com/storage/`**. If they say `http://`, `trustProxies` is not in effect — stop and diagnose before anyone registers, because verification links would be signed over the wrong scheme.

- [ ] **Step 6: Full functional pass in a browser**

Against `https://online-trash.com`: feed renders with images and paginates; permalink loads; **register a new account and confirm the verification e-mail arrives**; click the link and confirm verification succeeds; log in and confirm the session cookie is `Secure`; upload an image; upload a YouTube link; post a comment; open `/admin/trashposts` and `/admin/users` as an admin; confirm a 404 page returns no stack trace.

- [ ] **Step 7: Watch resources under real load**

```sh
docker stats --no-stream
free -h
df -h /
```

Expected: within the spec §5 budget, swap barely touched.

---

### Task 16: Enable nightly backups

**Runs on:** `root@online-trash.com`

**Interfaces:**
- Consumes: Task 9's scripts and Task 11's credentials.
- Produces: populated `/db`, `/env` and `/media`. Task 17 restores from them.

- [ ] **Step 1: Run a backup by hand**

The first run uploads the full 1.3 GB media seed and will take a while.

```sh
cd /web/online-trash.com
./backup.sh
```

Expected: each stage prints, ending `Backup complete: <stamp>`.

- [ ] **Step 2: Verify what landed**

```sh
. /root/.ladybug-ftp
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/db/"
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/env/"
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/media/" | head
```

Expected: one timestamped `.sql.gz.gpg`, one `env-*.tar.gz.gpg`, and the media tree.

- [ ] **Step 3: Prove the dump actually decrypts**

An encrypted backup nobody has decrypted is not a backup.

```sh
cd /tmp
. /root/.ladybug-ftp
LATEST=$(curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --list-only "ftp://${FTP_HOST}/db/" | sort | tail -1)
curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/db/${LATEST}" -o "$LATEST"
gpg --batch --decrypt --passphrase-file /root/.ladybug-backup-pass "$LATEST" \
  | gunzip | head -5
rm -f "/tmp/${LATEST}"
```

Expected: readable SQL (`-- MySQL dump ...`).

- [ ] **Step 4: Verify retention**

```sh
for i in 1 2 3 4 5 6; do ./backup.sh >/dev/null 2>&1 || true; sleep 61; done
curl --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --list-only "ftp://${FTP_HOST}/db/" | wc -l
```

Expected: `5`. (The `sleep` is needed because the stamp has minute resolution.) If a full six-run loop is too slow, upload five dated dummy files and confirm the sixth run prunes to five.

**This step found a real bug, 2026-07-29 — the dummy-file variant is the one to
use, and `wc -l` on the raw listing is the wrong assertion.** This server's
`NLST` includes `.` and `..`, so the listing is always two entries longer than
the number of backups. Worse, under C collation both sort *before* the
timestamped dumps, so `prune_remote`'s `sort | head -n -5` selected `.`, `..`
and the oldest dump for deletion, and `DELE /db/.` fails → `--fail` → the `ERR`
trap → the whole backup aborts and mails a failure. It stayed invisible because
it can only fire once a sixth backup exists, i.e. it would have started failing
on the sixth night, having never once pruned. `prune_remote` now takes a
filename regex and filters the listing before sorting; verified by seeding five
older dummies and confirming the next run pruned exactly the oldest two, leaving
five real backups and touching nothing else. Assert on
`--list-only | grep -E '^trashdb-' | wc -l`, not on the bare listing.

- [ ] **Step 5: Schedule it**

```sh
crontab -e
```

Add:

```cron
# Nightly off-box backup: DB dump + env bundle (5 retained, encrypted) and an
# incremental media mirror, to the Zone hosting account over FTPS.
30 2 * * * /web/online-trash.com/backup.sh >> /var/log/ladybug-backup.log 2>&1
```

Verify with `crontab -l` that both this and the Task 11 renewal entry are present.

---

### Task 17: Rehearse the restore

An untested restore is not a backup. This is the last gate.

**Runs on:** a scratch location — **not** the live stack.

**Interfaces:**
- Consumes: everything.
- Produces: a validated `docs/DEPLOYMENT.md` and a known recovery time.

- [ ] **Step 1: Stage an isolated rehearsal stack**

Do not point this at `/web/online-trash.com`. Use a separate directory and a separate compose project so nothing touches live data.

```sh
mkdir -p /tmp/ladybug-dr/data/{mysql,storage/app/public,backups}
cd /tmp/ladybug-dr
cp /root/ladybug/deploy/docker-compose.prod.yml docker-compose.yml
# Detach from the shared edge network, then publish a loopback port instead.
sed -i '/^      - edge$/d' docker-compose.yml
sed -i '/^networks:$/,$d' docker-compose.yml
cat > docker-compose.override.yml <<'YML'
services:
  ladybug-web:
    ports:
      - "127.0.0.1:8099:80"
YML
```

**Corrected 2026-07-29, during the rehearsal.** This step originally said only
"do NOT reuse the live port" and sed'd `127.0.0.1:8080:80` → `8099`. That sed is
a no-op — Task 4's fix (`d016495`) removed the loopback publish entirely, so
`ladybug-web` has no `ports:` at all now and is reached over the external
`nginx_default` network by bare name (`set $upstream ladybug-web;`, Task 7).
Compose creates that alias **per project**, so bringing the rehearsal up as
written would have put a *second* container answering to `ladybug-web` on the
edge network and the edge would have round-robined **live traffic into the
rehearsal stack**. Detaching from `edge` is therefore mandatory, not tidiness,
and the loopback publish has to be added rather than rewritten.

- [ ] **Step 2: Recover the secrets from the backup, as a real recovery would**

```sh
. /root/.ladybug-ftp
LATEST=$(curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --list-only "ftp://${FTP_HOST}/env/" | sort | tail -1)
curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/env/${LATEST}" -o env.tar.gz.gpg
gpg --batch --decrypt --passphrase-file /root/.ladybug-backup-pass env.tar.gz.gpg | tar -xzf -
ls -la backend.env .env
```

Expected: both files recovered. **This step is the whole point** — if the passphrase or the bundle is wrong, you have just learned it in a rehearsal rather than an emergency.

- [ ] **Step 3: Bring the rehearsal stack up and restore into it**

```sh
chown -R 33:33 data/storage
docker compose -p ladybug-dr up -d
sleep 30
docker compose -p ladybug-dr exec -T ladybug-php php artisan migrate --force

LATEST=$(curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" --list-only "ftp://${FTP_HOST}/db/" | sort | tail -1)
curl -s --ssl-reqd --user "${FTP_USER}:${FTP_PASS}" "ftp://${FTP_HOST}/db/${LATEST}" -o dump.gpg
gpg --batch --decrypt --passphrase-file /root/.ladybug-backup-pass dump.gpg | gunzip \
  | docker compose -p ladybug-dr exec -T ladybug-mysql \
      mysql -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" trashdb
```

- [ ] **Step 4: Verify the rehearsal stack serves the real corpus**

```sh
curl -fsS http://127.0.0.1:8099/api/health; echo
curl -fsS http://127.0.0.1:8099/api/posts | head -c 300; echo
docker compose -p ladybug-dr exec -T ladybug-php php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
echo "posts=", \App\Models\Trashpost::count(), " users=", \App\Models\User::count(), PHP_EOL;
'
```

Expected: counts matching production. Media is not restored here (the mirror is large and the point is the data path); note that `restore.sh` step separately.

- [ ] **Step 5: Tear the rehearsal down completely**

```sh
cd /tmp/ladybug-dr
docker compose -p ladybug-dr down -v
cd / && rm -rf /tmp/ladybug-dr
docker compose -f /web/online-trash.com/docker-compose.yml ps
free -h
```

Expected: the rehearsal is gone, the **live** stack is untouched and still running.

- [ ] **Step 6: Correct the runbook and record the recovery time**

Fix anything in `docs/DEPLOYMENT.md` that did not match reality, and record the measured end-to-end recovery time in the DR section.

```bash
cd /root/ladybug   # or on the dev box
git add docs/DEPLOYMENT.md
git commit -m "docs(deploy): correct the DR runbook against the rehearsal"
git push origin master
```

- [ ] **Step 7: Declare launch complete**

Confirm all of: site public over HTTPS; verification mail delivered; uploads and comments working; both cron entries present (`crontab -l`); backups on the FTP with 5-item retention; restore rehearsed; `free -h` and `df -h` healthy.

---

## Self-review notes

**Spec coverage.** Every section of the design maps to a task: topology → 3, 4, 7; images and pipeline → 2, 3, 6; server layout → 8, 11; configuration and secrets → 4, 8, 11; resource budget → 2 (php.ini/www.conf), 4 (MySQL flags), 8 (swap), 12/15 (measurement); edge nginx and TLS → 7, 11, 15; data migration → 13, 14; backups and DR → 9, 16, 17; code changes → 1; the secrets-never-leak section → 3 (bundle scan), 4 (gitignore), 6 (image history), 9 (script scan).

**Deliberate ordering choices.** Task 5 exists so the first encounter with a broken production image happens on a 32 GB dev box rather than a 960 MiB server. Task 14 precedes Task 15 so every failure is private. Task 17 is last because it is the only task that proves the backups are real.

**Naming consistency.** Service names `ladybug-mysql` / `ladybug-php` / `ladybug-web` are used identically in `docker-compose.prod.yml`, the `fastcgi_pass` in `deploy/web/default.conf`, `DB_HOST` in `backend.env.example`, and every `docker compose exec` in Tasks 12–17. The port `127.0.0.1:8080` is consistent across compose, the edge `proxy_pass`, and all health checks. Image paths are `ghcr.io/urmomeesak77/ladybug-{php,web}` throughout.
