# Schema Contract: `trashdb`

This feature exposes no HTTP/API surface. Its **contract is the database schema** — the
tables, columns, types, nullability, defaults, and keys that future features and the manual
data importer depend on. The contract below is the authoritative target for the Laravel
migrations; it reflects the **live** prototype structure (excluding `temp`/`oldfile`/`text`)
with `user` upgraded to `user_id`.

Driver notes: `utf8mb4_bin` collation and `ON UPDATE CURRENT_TIMESTAMP` are applied on
**MySQL** only (runtime). On the **SQLite** test runner these degrade to portable
equivalents (binary/case-sensitive comparison; no ON UPDATE) — behaviour asserted by tests
holds on both engines (see research R2, R3).

## Table: `trashposts`

Reference MySQL DDL (what the migration produces on MySQL 8.0):

```sql
CREATE TABLE `trashposts` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hash`         VARCHAR(10) COLLATE utf8mb4_bin NULL,
  `title`        VARCHAR(255) NULL,
  `type`         VARCHAR(255) NULL,
  `file`         VARCHAR(255) NULL,
  `youtube`      VARCHAR(255) NULL,
  `user_id`      BIGINT UNSIGNED NULL,
  `comment`      TEXT NULL,
  `metadata`     TEXT NULL,
  `created_at`   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `activated_at` TIMESTAMP NULL,
  `deleted_at`   TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trashposts_hash_unique` (`hash`),
  CONSTRAINT `trashposts_user_id_foreign`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
);
```

Migration intent (Laravel Blueprint, MySQL path):

```php
Schema::create('trashposts', function (Blueprint $table) {
    $table->id();
    $hash = $table->string('hash', 10)->nullable()->unique();
    if ($isMysql) {
        $hash->collation('utf8mb4_bin');
    }
    $table->string('title')->nullable();
    $table->string('type')->nullable();
    $table->string('file')->nullable();
    $table->string('youtube')->nullable();
    $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
    $table->text('comment')->nullable();
    $table->text('metadata')->nullable();
    $table->timestamp('created_at')->nullable()->useCurrent();
    $updated = $table->timestamp('updated_at')->nullable()->useCurrent();
    if ($isMysql) {
        $updated->useCurrentOnUpdate();
    }
    $table->timestamp('activated_at')->nullable();
    $table->timestamp('deleted_at')->nullable();
});
```

`down()`: `Schema::dropIfExists('trashposts');`

**Excluded** (must NOT be created): `temp`, `oldfile`, `text`, free-text `user`.

## Table: `users` (amended)

The existing `0001_01_01_000000_create_users_table.php` gains a `hash` column. Resulting
MySQL DDL for the relevant columns:

```sql
CREATE TABLE `users` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`              VARCHAR(255) NOT NULL,
  `hash`              VARCHAR(10) COLLATE utf8mb4_bin NOT NULL,
  `email`             VARCHAR(255) NOT NULL,
  `email_verified_at` TIMESTAMP NULL,
  `password`          VARCHAR(255) NOT NULL,
  `remember_token`    VARCHAR(100) NULL,
  `created_at`        TIMESTAMP NULL,
  `updated_at`        TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_hash_unique` (`hash`),
  UNIQUE KEY `users_email_unique` (`email`)
);
```

Migration intent (added inside the existing `Schema::create('users', ...)`):

```php
$hash = $table->string('hash', 10)->unique();
if ($isMysql) {
    $hash->collation('utf8mb4_bin');
}
```

`password_reset_tokens` and `sessions` tables in that migration are unchanged.

## Migration ledger / reversibility

- Both migrations implement `up()` and `down()`; `php artisan migrate` records them in the
  `migrations` table and never re-applies an applied migration (FR-006).
- `php artisan migrate:rollback` (or `migrate:fresh`) drops the tables cleanly with no
  orphaned objects (SC-005). Dropping `trashposts` first (later migration rolls back first)
  removes the FK before `users` is dropped.

## Consumers of this contract

- **Manual data importer** (operator, out of scope): inserts rows preserving each `hash`
  verbatim; relies on the unique constraints to reject duplicates and on the nullable
  `user_id` FK when mapping the old `user` string to an account.
- **Future app features**: feed/auth/API read and write these tables via the Eloquent
  `Trashpost` and `User` models.
