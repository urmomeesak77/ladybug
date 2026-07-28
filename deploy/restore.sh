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
