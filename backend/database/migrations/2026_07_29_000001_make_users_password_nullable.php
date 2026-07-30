<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * A Google-created account has no password at all (FR-020, data-model §2), so
     * NOT NULL cannot survive. Laravel 11+ modifies columns natively — ->change()
     * needs no doctrine/dbal, so Principle I is untouched.
     *
     * The invariant this gives up ("every account has a password") is replaced by
     * two behavioural guards, both asserted rather than assumed: LoginRequest keeps
     * `password` required, and Hash::check() fails closed on a null stored hash.
     * See contracts/password-login-invariant.md.
     */
    public function up(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable()->change();
        });
    }

    /**
     * Restoring NOT NULL is clean only on a schema with no passwordless rows, which
     * is what MigrationReversibilityTest exercises. On a live database that already
     * holds Google-created accounts, MySQL errors under strict mode and silently
     * coerces NULL → '' without it — so rolling this back in production is a runbook
     * procedure, not a command. quickstart.md §6 carries it.
     */
    public function down(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable(false)->change();
        });
    }
};
