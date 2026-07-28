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
