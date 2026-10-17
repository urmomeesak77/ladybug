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
# below fails with "not found". That failure is safe -- it happens before
# maintenance mode and before the `up -d`, so the stack is still serving the old tag
# -- but it is a confusing way to learn the argument was wrong.
#
# Order of operations, and why:
#   1. pull          -- slow, and harmless: the old stack keeps serving throughout.
#   2. artisan down  -- on the OLD container, BEFORE anything is recreated. The flag is
#                       storage/framework/down (APP_MAINTENANCE_DRIVER=file), which lives
#                       on the ./data/storage bind mount, so it survives the recreate and
#                       the NEW container starts already in maintenance: new code never
#                       answers a request against the old schema.
#   3. up -d         -- recreate onto the new images.
#   4. DB dump       -- immediately before migrating, so a bad migration is recoverable
#                       to the exact pre-deploy state, not to last night's backup.
#   5. migrate
#   6. artisan up    -- ONLY after a successful migration.
#   7. health check
#
# FAIL CLOSED: any failure from step 2 until step 6 leaves the site IN MAINTENANCE and
# prints how to recover. It never runs `artisan up` on its own -- after a failed
# migration the schema may be half-applied, and the old trap that lifted maintenance on
# every exit served live traffic on exactly that schema.
set -euo pipefail

ROOT=/web/online-trash.com
TAG="${1:-latest}"
PASSPHRASE_FILE=/root/.ladybug-backup-pass
cd "$ROOT"

# Every release pulls a ~1.4 GB ladybug-php image and nothing ever removed the old
# ones, so they piled up until the 19 GB root disk hit 87% (2026-09-25). Keep only the
# tag just deployed and the one it replaced (the rollback target); everything older is
# re-pullable from GHCR by its SHA anyway. Runs only after a healthy deploy, and a
# failure here must never fail the deploy, hence the `|| true`s.
prune_old_images() {
    echo "==> Pruning old images (keeping ${TAG} and ${PREV_TAG})"
    local img tag
    for img in $(docker images --format '{{.Repository}}:{{.Tag}}' \
            | grep -E '^ghcr\.io/urmomeesak77/ladybug-(php|web):'); do
        tag="${img##*:}"
        if [ "$tag" = "$TAG" ] || [ "$tag" = "$PREV_TAG" ]; then
            continue
        fi
        docker rmi "$img" >/dev/null 2>&1 && echo "    removed $img" || true
    done
    docker image prune -f >/dev/null 2>&1 || true
}

# The queue worker (024) is the one service whose death the health poll cannot see: the
# site keeps answering /api/health while uploads sit "processing" and no mail leaves.
# So say, after every healthy deploy, whether it is running and how many jobs have given
# up. Informational only -- it never fails the deploy (the site IS up); a non-zero
# failed count is the operator's cue for docs/DEPLOYMENT.md "The queue worker (024)".
queue_summary() {
    echo "==> Queue worker"
    if [ -n "$(docker compose ps -q --status running ladybug-queue 2>/dev/null)" ]; then
        echo "    ladybug-queue is running"
    else
        echo "    WARNING: ladybug-queue is NOT running -- uploads will not finish processing"
    fi
    local failed
    # Straight from MySQL, authenticated the same way as the pre-migration dump above.
    failed="$(docker compose exec -T ladybug-mysql sh -c \
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -N -uroot trashdb -e "SELECT COUNT(*) FROM failed_jobs"' \
        2>/dev/null || true)"
    echo "    failed jobs: ${failed:-unknown}"
}

# The exact command that puts the previous build back. Only a full SHA is a real
# rollback target: `latest` has just been re-pointed at the NEW build by the pull.
rollback_hint() {
    if [ -n "$PREV_SHA" ]; then
        echo "    Roll back to the previous build with:"
        echo "        cd ${ROOT} && ./deploy.sh ${PREV_SHA}"
    else
        echo "    The previous build's SHA is unknown (it was deployed as '${PREV_TAG:-<none>}'"
        echo "    from an image with no revision label). Find it with \`git log\` on master"
        echo "    and run: cd ${ROOT} && ./deploy.sh <full-40-char-sha>"
    fi
}

# Runs on EVERY exit; does nothing unless the script is failing inside the maintenance
# window. Deliberately does NOT run `artisan up` -- see FAIL CLOSED above.
on_exit() {
    local rc=$?
    [ "$rc" -ne 0 ] || return 0
    # Before maintenance (a failed pull) and after `artisan up` nothing needs saying here.
    case "$PHASE" in prepare|live) return 0 ;; esac
    {
        echo
        echo "!!! deploy.sh FAILED (exit ${rc}) during: ${PHASE}"
        echo "!!! The site is STILL IN MAINTENANCE MODE (503 to every visitor)."
        case "$PHASE" in
            migrate)
                echo "    The migration failed part-way: the schema may be half-applied."
                echo "    Pre-migration dump: ${ROOT}/${DUMP}"
                echo "    Restore it (drops and recreates every table in the dump):"
                echo "        cd ${ROOT} && gpg --batch --decrypt --passphrase-file ${PASSPHRASE_FILE} ${DUMP} \\"
                echo "          | gunzip | docker compose exec -T ladybug-mysql \\"
                echo "              sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot trashdb'"
                echo "    Tables the failed migration CREATED are not in the dump and survive the"
                echo "    restore: drop them by hand, or re-running that migration will fail."
                echo "    Then roll the code back:"
                ;;
            *)
                echo "    No migration has run: the schema is untouched."
                ;;
        esac
        rollback_hint
        echo "    Or, ONLY once you are sure code and schema agree, lift maintenance with:"
        echo "        cd ${ROOT} && docker compose exec -T ladybug-php php artisan up"
    } >&2
}
PHASE=prepare
DUMP=""
trap on_exit EXIT

# Remembered so the prune step below can keep it as the rollback target.
PREV_TAG="$(sed -n 's/^LADYBUG_TAG=//p' .env)"

# The previous build's commit, for the rollback hint. A full-SHA tag IS the commit.
# Otherwise (`latest`, the usual case) read it off the image the RUNNING container
# was created from -- by image ID, which the pull below cannot re-point -- via the
# revision label release.yml stamps with the CI-validated SHA. Best effort only.
PREV_SHA=""
if [[ "$PREV_TAG" =~ ^[0-9a-f]{40}$ ]]; then
    PREV_SHA="$PREV_TAG"
else
    PREV_CID="$(docker compose ps -q ladybug-php 2>/dev/null || true)"
    if [ -n "$PREV_CID" ]; then
        PREV_SHA="$(docker inspect -f '{{.Image}}' "$PREV_CID" 2>/dev/null \
            | xargs -r docker image inspect \
                -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null \
            || true)"
        [[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]] || PREV_SHA=""
    fi
fi

echo "==> Deploying tag: $TAG (previous: ${PREV_TAG:-<none>})"
sed -i "s|^LADYBUG_TAG=.*|LADYBUG_TAG=${TAG}|" .env

# Before maintenance: a failed pull (wrong SHA, GHCR down) leaves the old stack serving.
# Put the old tag back in .env so a later plain `docker compose up -d` cannot pick up
# a tag that never arrived.
if ! docker compose pull; then
    sed -i "s|^LADYBUG_TAG=.*|LADYBUG_TAG=${PREV_TAG}|" .env
    echo "    pull failed -- nothing changed, still serving ${PREV_TAG:-the old tag}" >&2
    exit 1
fi

echo "==> Maintenance mode (on the running build)"
PHASE=maintenance
# On the OLD container, while it is still the one serving traffic. A stack that is not
# running at all (first deploy, disaster recovery) has nothing to protect, and the new
# container still boots straight into maintenance if a flag was left behind.
if [ -n "$(docker compose ps -q --status running ladybug-php 2>/dev/null)" ]; then
    docker compose exec -T ladybug-php php artisan down
else
    echo "    ladybug-php is not running -- nothing is serving, skipping"
fi

echo "==> Recreating containers"
PHASE="container recreate"
docker compose up -d --remove-orphans

# `exec` needs php-fpm's entrypoint (config/route/view caches) to have finished, and
# mysqld to accept connections; `up -d` waits for mysql's healthcheck via depends_on.
for i in $(seq 1 30); do
    docker compose exec -T ladybug-php php artisan --version >/dev/null 2>&1 && break
    [ "$i" -lt 30 ] || { echo "    ladybug-php never became ready" >&2; exit 1; }
    sleep 1
done

echo "==> Pre-migration database dump"
PHASE="pre-migration dump"
# Same pipeline as backup.sh (consistent snapshot, gzip, gpg with the backup
# passphrase), so it decrypts with the same key. The root password never touches the
# host's command line or the container's argv: the mysql container already holds it in
# MYSQL_ROOT_PASSWORD, and MYSQL_PWD hands it to mysqldump through the environment.
# Encrypted for the same reason too (e-mail addresses, bcrypt hashes). Kept on the box
# only, newest 3 -- the nightly backup.sh remains the off-box copy.
mkdir -p data/backups
DUMP="data/backups/predeploy-$(date +%Y%m%d-%H%M%S)-${TAG:0:12}.sql.gz.gpg"
docker compose exec -T ladybug-mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --routines --no-tablespaces -uroot trashdb' \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" -o "$DUMP"
echo "    ${DUMP} ($(du -h "$DUMP" | cut -f1))"
ls -1t data/backups/predeploy-*.sql.gz.gpg 2>/dev/null | tail -n +4 | xargs -r rm --

# Migrations run against the NEW image, so the schema matches the code that will serve
# requests. --force is required: artisan refuses to migrate in production
# interactively, and there is no TTY here.
echo "==> Migrating"
PHASE=migrate
docker compose exec -T ladybug-php php artisan migrate --force

echo "==> Ending maintenance mode"
docker compose exec -T ladybug-php php artisan up
PHASE=live

echo "==> Health check"
# Run from INSIDE ladybug-web, not the host: the container publishes no port (it is
# reached only from the edge, over the shared nginx_default network), so a host-side
# curl to a loopback port would silently test nothing and this would report "healthy"
# even if the edge itself could never reach the stack. nginx:alpine ships busybox wget.
for i in $(seq 1 20); do
    if docker compose exec -T ladybug-web wget -qO- http://127.0.0.1/api/health >/dev/null 2>&1; then
        echo "    healthy after ${i}s"
        docker compose ps
        queue_summary
        prune_old_images
        exit 0
    fi
    sleep 1
done

# NOT rolled back automatically: the migration above has already been applied, and
# migrations only move forward, so the previous build may not run against this schema.
# The stack is left as-is (and out of maintenance) so there is something to inspect.
{
    echo "    FAILED -- stack did not answer /api/health within 20s"
    docker compose ps
    docker compose logs --tail=50
    echo
    rollback_hint
    echo "    If the previous build cannot run on the migrated schema, restore the"
    echo "    pre-migration dump first: ${ROOT}/${DUMP} (see docs/DEPLOYMENT.md, Section 5)."
} >&2
exit 1
