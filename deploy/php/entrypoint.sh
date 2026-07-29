#!/bin/sh
# Cache config, routes and views at CONTAINER START -- never at image build.
# config:cache freezes whatever environment it can see into a PHP file; running it
# during the build would bake the BUILDER's environment into a public image and
# then ignore the real .env that gets bind-mounted at run time.
set -e

# The compose stack bind-mounts a host directory over /var/www/html/storage, which
# shadows the skeleton baked into the image -- on a fresh server that host directory
# is empty. Recreate it here so the container is self-sufficient wherever it is
# mounted. These are needed beyond view:cache: SESSION_DRIVER=file, CACHE_STORE=file
# and file logging all write here on the first request.
mkdir -p storage/app/public \
         storage/app/private \
         storage/framework/cache/data \
         storage/framework/sessions \
         storage/framework/views \
         storage/logs

# Dotenv's safeLoad() silently ignores an unreadable .env, and `config:cache` then
# succeeds against framework defaults -- the app boots pointing at 127.0.0.1 with an
# empty APP_KEY. Fail here instead, where the cause is obvious.
[ -r .env ] || { echo "FATAL: /var/www/html/.env is not readable by $(id -un) (uid $(id -u))." >&2; exit 1; }

# Same shape, same reason: without the SPA shell every HTML address 500s at request
# time, one visitor at a time, with the cause buried in the log. A packaging error
# belongs at boot, where it is unmissable and the deploy can be rolled back.
[ -r resources/spa/index.html ] || { echo "FATAL: /var/www/html/resources/spa/index.html is not readable by $(id -un) (uid $(id -u)) -- the Dockerfile's node stage did not deliver the built SPA shell." >&2; exit 1; }

php artisan config:cache
php artisan route:cache
php artisan view:cache

exec "$@"
