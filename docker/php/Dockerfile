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

# Reuse Composer from its official image rather than installing it by hand.
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
