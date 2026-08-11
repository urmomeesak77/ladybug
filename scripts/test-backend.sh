#!/bin/sh
# In-container half of scripts/test-backend.ps1 — do not run this by hand.
#
# Why this exists: the backend suite is not slow, the Windows bind mount is. Every
# test rebuilds the Laravel application (RefreshDatabase's per-test
# refreshApplication), and each boot makes hundreds of filesystem calls that
# opcache cannot elide (file_exists/is_dir probes, the .env read). Crossing the
# Windows->Linux mount, those cost ~150ms per test, which is where 1097 tests spend
# five minutes. Measured on the same 74 tests: 67s off the mount, 9.5s off the
# container's own filesystem.
#
# So: keep a mirror of backend/ in a named volume (container-local, i.e. real ext4)
# and run PHPUnit there. Only the mirror's inputs are read across the mount, never
# the framework itself.
set -e

SRC=/src
WORK=/work

# vendor/ is 8087 of the tree's 8300 files and only moves when composer.lock does,
# so re-copying it every run would hand back the whole saving (145s cold).
if [ ! -f "$WORK/vendor/autoload.php" ] || ! cmp -s "$SRC/composer.lock" "$WORK/composer.lock"; then
    echo "test-backend: composer.lock changed (or first run) — syncing vendor/, this takes a couple of minutes..."
    rm -rf "$WORK/vendor"
    cp -a "$SRC/vendor" "$WORK/vendor"
fi

# Everything the suite actually reads, minus vendor/ and storage/: ~220 files, ~3s.
# rm before cp so a file deleted on the host disappears from the mirror too — a
# stale copy of a deleted test would otherwise keep passing/failing forever.
for path in app bootstrap config database public resources routes tests artisan composer.json composer.lock phpunit.xml; do
    if [ -e "$SRC/$path" ]; then
        rm -rf "$WORK/$path"
        cp -a "$SRC/$path" "$WORK/$path"
    fi
done

# The mirror gets its OWN empty storage tree rather than a copy of the host's 12 MB
# one: the suite writes only Storage::fake disks and logs, and never reads the real
# media library.
mkdir -p "$WORK/storage/framework/testing" "$WORK/storage/framework/cache/data" \
    "$WORK/storage/framework/sessions" "$WORK/storage/framework/views" \
    "$WORK/storage/app/public" "$WORK/storage/logs"

# Mirror the developer's own .env so this runner is a drop-in for
# `docker compose exec backend php artisan test` and cannot quietly test something
# else. It is NOT a database risk: phpunit.xml forces sqlite :memory: and
# Tests\TestCase aborts the run if anything else resolves.
if [ -f "$SRC/.env" ]; then
    cp -a "$SRC/.env" "$WORK/.env"
else
    cp -a "$SRC/.env.example" "$WORK/.env"
fi

cd "$WORK"
grep -q '^APP_KEY=base64:' .env || php artisan key:generate --quiet

exec vendor/bin/phpunit "$@"
