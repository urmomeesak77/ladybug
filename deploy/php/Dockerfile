# Production image for the Ladybug API: PHP 8.3 FPM behind the stack's own nginx.
# Mirrors the dev image (docker/php/Dockerfile) MINUS pcov, which is a coverage
# driver with no place in production, and minus the dev Composer dependencies.
#
# Build context is the REPO ROOT, so this can copy backend/ (see release.yml).

FROM composer:2 AS vendor
WORKDIR /app
# Dependency manifests first: this layer is cached until composer.lock changes.
COPY backend/composer.json backend/composer.lock ./
# composer:2's own PHP lacks bcmath/gd (it only resolves and downloads packages
# here, never executes app code), so its platform check on this repo's composer.json
# requirements is ignored for those two -- both are compiled into the runtime stage
# below and are what actually matters.
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress \
        --no-scripts --no-autoloader \
        --ignore-platform-req=ext-bcmath --ignore-platform-req=ext-gd
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
