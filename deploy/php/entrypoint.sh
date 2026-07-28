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
