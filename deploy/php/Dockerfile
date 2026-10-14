# Production image for the Ladybug API: PHP 8.3 FPM behind the stack's own nginx.
# Mirrors the dev image (docker/php/Dockerfile) MINUS pcov, which is a coverage
# driver with no place in production, and minus the dev Composer dependencies.
#
# Build context is the REPO ROOT, so this can copy backend/ (see release.yml).

# The SPA shell Laravel injects its <head> into must be the BUILT index.html, with
# its content-hashed asset tags -- and that file exists only inside the web image.
# So the php image builds the frontend a second time and keeps just that one file
# (research D2, plan.md -> Complexity Tracking). The two images cannot disagree:
# release.yml builds both from the same commit in one matrix, deploy.sh pins one
# LADYBUG_TAG for both, and Vite's hashes are content-derived. Buildx's gha layer
# cache makes the repeat build free unless frontend/ actually changed.
FROM node:20 AS shell
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

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
# read/write. ffmpeg (bundles ffprobe) backs video decode validation + poster-frame
# extraction (owner-approved 2026-08-05, research.md #2). No git/unzip: Composer
# already ran in the vendor stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev \
        gifsicle imagemagick ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Repo-controlled ImageMagick security policy (coder allow-list + resource limits) over
# the distribution's own -- see the file's header for why. The directory is versioned
# (/etc/ImageMagick-7 on today's Debian 13 base), so it is globbed rather than hard-coded
# and the build FAILS if there is not exactly one, or if the policy did not load: the
# file's comments are tokenised by ImageMagick, and a stray quote silently drops every
# policy after it, so the last policy line (the allow-list) and the first (memory) are
# both checked against what ImageMagick actually reports.
COPY deploy/php/imagemagick-policy.xml /tmp/imagemagick-policy.xml
RUN set -eu; \
    dir="$(echo /etc/ImageMagick-*)"; \
    [ -f "$dir/policy.xml" ]; \
    install -m 0644 /tmp/imagemagick-policy.xml "$dir/policy.xml"; \
    rm /tmp/imagemagick-policy.xml; \
    convert -list policy | grep -qF 'pattern: {GIF,JPEG,JPG,PNG,WEBP}'; \
    identify -list resource | grep -q 'Memory: 256MiB'
# ImageMagick 7.1.1 ignores the policy's `time` resource (measured), but honours this.
# php-fpm workers do not inherit it (clear_env), so www.conf passes it on via env[].
ENV MAGICK_TIME_LIMIT=60

RUN docker-php-ext-configure gd --with-jpeg --with-freetype --with-webp \
    && docker-php-ext-install pdo_mysql zip bcmath gd opcache

COPY deploy/php/php.ini /usr/local/etc/php/conf.d/zz-ladybug.ini
COPY deploy/php/www.conf /usr/local/etc/php-fpm.d/zz-ladybug.conf
COPY deploy/php/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /var/www/html
COPY --from=vendor --chown=www-data:www-data /app /var/www/html
# Only the shell itself: the assets it references are served by the web image off
# its own copy of dist/, never through PHP.
COPY --from=shell --chown=www-data:www-data /app/dist/index.html /var/www/html/resources/spa/index.html

# Drop root: the entrypoint writes bootstrap/cache and storage, both owned by www-data.
USER www-data

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["php-fpm"]
