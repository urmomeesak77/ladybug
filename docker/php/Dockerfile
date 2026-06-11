# Dev image for the Ladybug backend: PHP 8.3 CLI matching CI (FR-008), with the
# extensions the app and the >=90% coverage gate need. Local dev only, not a
# production image (FR-009).
FROM php:8.3-cli

# System libraries required to build the bundled PHP extensions below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip libzip-dev \
    && rm -rf /var/lib/apt/lists/*

# pdo_mysql: app database driver. zip: composer dist installs. bcmath:
# arbitrary-precision math for App\Utils\Base64 hash generation (matches the
# CI extension list in .github/workflows/ci.yml). pcov: line coverage driver
# for `php artisan test --coverage` (matches CI).
RUN docker-php-ext-install pdo_mysql zip bcmath \
    && pecl install pcov \
    && docker-php-ext-enable pcov

# opcache is bundled with the base image but ships disabled. Enabling it (incl.
# CLI mode, since `artisan serve` runs under the CLI SAPI) caches compiled PHP in
# memory so each request stops re-reading the framework off the slow bind mount.
RUN docker-php-ext-enable opcache
COPY opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini

# Reuse Composer from its official image rather than installing it by hand.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
