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
