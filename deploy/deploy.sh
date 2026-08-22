#!/usr/bin/env bash
# Pull a released image tag and roll the stack onto it.
#
#   ./deploy.sh              -> latest
#   ./deploy.sh <full-sha>   -> that exact build (this is also how you roll back;
#                               every release is tagged with its commit SHA)
#
# The SHA must be the FULL 40 characters, as `git rev-parse` prints it. release.yml
# tags with type=raw off the full SHA, not metadata-action's type=sha, so a
# 7-character abbreviation is simply not a tag that exists and `docker compose pull`
# below fails with "not found". That failure is safe -- it happens before the
# `up -d`, so the stack is still on the old tag and maintenance mode was never
# entered -- but it is a confusing way to learn the argument was wrong.
set -euo pipefail

ROOT=/web/online-trash.com
TAG="${1:-latest}"
cd "$ROOT"

echo "==> Deploying tag: $TAG"
sed -i "s|^LADYBUG_TAG=.*|LADYBUG_TAG=${TAG}|" .env

docker compose pull
docker compose up -d --remove-orphans

echo "==> Maintenance mode"
# New code is already serving requests at this point (docker compose up -d just
# restarted ladybug-php/-web on the new image) but the schema has not migrated yet --
# without maintenance mode, that window lets new code run queries against the old
# schema. `artisan down` closes it until the migration has landed.
docker compose exec -T ladybug-php php artisan down

# Guarantee `artisan up` runs no matter how the script exits from here on: if the
# migration fails, set -e would otherwise exit the script with the site stuck in
# maintenance mode until someone notices and clears it by hand. Cleared right after
# the normal `artisan up` call below so the ordinary success path does not run it
# twice.
trap 'docker compose exec -T ladybug-php php artisan up' EXIT

# Migrations run against the NEW image, after it is up, so the schema matches the code
# that will serve requests. --force is required: artisan refuses to migrate in
# production interactively, and there is no TTY here.
echo "==> Migrating"
docker compose exec -T ladybug-php php artisan migrate --force

echo "==> Ending maintenance mode"
docker compose exec -T ladybug-php php artisan up
trap - EXIT

echo "==> Health check"
# Run from INSIDE ladybug-web, not the host: the container publishes no port (it is
# reached only from the edge, over the shared nginx_default network), so a host-side
# curl to a loopback port would silently test nothing and this would report "healthy"
# even if the edge itself could never reach the stack. nginx:alpine ships busybox wget.
for i in $(seq 1 20); do
    if docker compose exec -T ladybug-web wget -qO- http://127.0.0.1/api/health >/dev/null 2>&1; then
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
