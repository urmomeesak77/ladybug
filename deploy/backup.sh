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

# `set -euo pipefail` aborts on the first failing command -- correct for not
# continuing past a broken step, but by default that abort is silent apart from a
# line in a cron log nobody reads, and this script is the only thing standing
# between a VPS reset and permanent data loss. Mail the operator on ANY failure.
#
# - `trap - ERR` first thing, so a failure in the mail step itself (e.g. the
#   container is already gone) cannot re-trigger this handler and loop.
# - $exit_code is captured before running anything else, and the handler ends by
#   re-raising it with `exit`, so the mail step (or lb_php failing) can never mask
#   the original failure's exit status.
# - `|| true` on the mail command itself: if sending the failure e-mail ALSO fails
#   (e.g. ladybug-php is the thing that's down), that must not overwrite $exit_code
#   or stop the explicit `exit "$exit_code"` below from running.
on_err() {
    local exit_code=$?
    trap - ERR
    echo "FAILED: backup.sh aborted (exit ${exit_code}) -- see the cron log." >&2
    lb_php "Mail::raw('online-trash.com backup.sh FAILED (exit ${exit_code}). The nightly backup did not complete -- check /var/log/ladybug-backup.log.', fn (\$m) =>
        \$m->to('urmo.meesak@gmail.com')->subject('[ladybug] backup FAILED'));" || true
    exit "$exit_code"
}
trap on_err ERR

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
#
# Also archives the shared edge's own nginx config and compose file -- NOT the cert
# store, which certbot re-issues on demand -- so the edge is genuinely recoverable
# from this bundle instead of merely documented in the DEPLOYMENT.md appendix. Both
# paths are outside $ROOT: this stack does not own the edge, so a box where they are
# missing (local testing, or the edge laid out differently) must not fail the whole
# backup over an optional extra -- included conditionally, relative to `/` via -C so
# a restore can untar them straight back into place.
ENVBUNDLE="data/backups/env-${STAMP}.tar.gz.gpg"
EDGE_EXTRAS=()
if [ -d /web/nginx/conf.d ] || [ -f /web/nginx/docker-compose.yml ]; then
    EDGE_EXTRAS+=(-C /)
    [ -d /web/nginx/conf.d ]             && EDGE_EXTRAS+=(web/nginx/conf.d)
    [ -f /web/nginx/docker-compose.yml ] && EDGE_EXTRAS+=(web/nginx/docker-compose.yml)
fi
tar -czf - backend.env .env "${EDGE_EXTRAS[@]}" \
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
