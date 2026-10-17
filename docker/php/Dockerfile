# Dev image for the Ladybug backend: PHP 8.3 CLI matching CI (FR-008), with the
# extensions the app and the >=90% coverage gate need. Local dev only, not a
# production image (FR-009).
FROM php:8.3-cli

# System libraries required to build the bundled PHP extensions below, plus
# approved animated-media resizers (GD only reads the first frame, so resizing in
# PHP would flatten them): gifsicle for animated GIFs, and imagemagick (`convert`)
# for animated WebP (owner-approved 2026-07-22). libwebp-dev enables GD's WebP
# read/write for static WebP (--with-webp below). ffmpeg (bundles ffprobe) backs
# video decode validation + poster-frame extraction (owner-approved 2026-08-05,
# research.md #2).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git unzip libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libwebp-dev \
        gifsicle imagemagick ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# The production ImageMagick security policy, so dev and e2e convert under the same
# coder allow-list and resource limits production enforces. This build context is
# docker/php/, which cannot reach deploy/, so the file here is a byte-identical COPY of
# deploy/php/imagemagick-policy.xml -- CI fails if the two differ. Same install-and-assert
# step as deploy/php/Dockerfile; see there and the file's header.
COPY imagemagick-policy.xml /tmp/imagemagick-policy.xml
RUN set -eu; \
    dir="$(echo /etc/ImageMagick-*)"; \
    [ -f "$dir/policy.xml" ]; \
    install -m 0644 /tmp/imagemagick-policy.xml "$dir/policy.xml"; \
    rm /tmp/imagemagick-policy.xml; \
    convert -list policy | grep -qF 'pattern: {GIF,JPEG,JPG,PNG,WEBP}'; \
    identify -list resource | grep -q 'Memory: 256MiB'
ENV MAGICK_TIME_LIMIT=60

# pdo_mysql: app database driver. zip: composer dist installs. bcmath:
# arbitrary-precision math for App\Utils\Base64 hash generation. gd: in-house
# image resizing/metadata for uploads (Principle I — no Composer image package).
# pcov: line coverage driver for `php artisan test --coverage` (matches the CI
# extension list in .github/workflows/ci.yml). Built straight from the pinned
# GitHub source tag rather than `pecl install`: pecl.php.net has answered "No
# releases available for package pecl.php.net/pcov" often enough to take the e2e
# job down twice, and retrying does not help a registry-side failure.
ENV PCOV_VERSION=1.0.12
RUN docker-php-ext-configure gd --with-jpeg --with-freetype --with-webp \
    && docker-php-ext-install pdo_mysql zip bcmath gd pcntl \
    && mkdir -p /usr/src/pcov \
    && curl -fsSL "https://codeload.github.com/krakjoe/pcov/tar.gz/refs/tags/v${PCOV_VERSION}" \
        | tar -xz -C /usr/src/pcov --strip-components=1 \
    && (cd /usr/src/pcov && phpize && ./configure --enable-pcov && make -j"$(nproc)" && make install) \
    && rm -rf /usr/src/pcov \
    && docker-php-ext-enable pcov

# opcache is bundled with the base image but ships disabled. Enabling it (incl.
# CLI mode, since `artisan serve` runs under the CLI SAPI) caches compiled PHP in
# memory so each request stops re-reading the framework off the slow bind mount.
RUN docker-php-ext-enable opcache
COPY opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini

# The stock image's upload limits are far under CreatePostRequest's 20 MiB video cap
# (research.md #5) — without this, a real-sized dev upload is truncated by PHP itself.
COPY uploads.ini /usr/local/etc/php/conf.d/zz-uploads.ini

# Reuse Composer from its official image rather than installing it by hand.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
