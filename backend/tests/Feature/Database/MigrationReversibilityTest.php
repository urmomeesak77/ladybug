<?php

declare(strict_types=1);

namespace Tests\Feature\Database;

use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Drives the migrations directly (no RefreshDatabase) to prove they build
 * forward, roll back to empty, and rebuild cleanly against the in-memory DB.
 */
final class MigrationReversibilityTest extends TestCase
{
    public function test_migrations_roll_back_and_re_apply_cleanly(): void
    {
        $this->artisan('migrate')->assertSuccessful();
        $this->assertTrue(Schema::hasTable('trashposts'));
        $this->assertTrue(Schema::hasTable('users'));

        // Rolls back the batch in reverse order: trashposts (later timestamp)
        // first, removing the FK before users is dropped — no leftover objects.
        $this->artisan('migrate:rollback')->assertSuccessful();
        $this->assertFalse(Schema::hasTable('trashposts'));
        $this->assertFalse(Schema::hasTable('users'));

        $this->artisan('migrate')->assertSuccessful();
        $this->assertTrue(Schema::hasTable('trashposts'));
        $this->assertTrue(Schema::hasTable('users'));
    }
}
