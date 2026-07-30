<?php

declare(strict_types=1);

namespace Tests\Feature\Database;

use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Drives the migrations directly (no RefreshDatabase) to prove they build
 * forward, roll back to empty, and rebuild cleanly against the in-memory DB.
 */
final class MigrationReversibilityTest extends TestCase {
    public function test_migrations_roll_back_and_re_apply_cleanly(): void {
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

    public function test_the_google_identity_migrations_reverse_cleanly(): void {
        // The 017 pair: user_identities is created, and users.password loses NOT NULL.
        // Both reverse on an EMPTY schema, which is the only state in which restoring
        // NOT NULL is a command rather than a runbook procedure (research D6).
        $this->artisan('migrate')->assertSuccessful();
        $this->assertTrue(Schema::hasTable('user_identities'));
        $this->assertTrue($this->passwordIsNullable());

        $this->artisan('migrate:rollback')->assertSuccessful();
        $this->assertFalse(Schema::hasTable('user_identities'));

        $this->artisan('migrate')->assertSuccessful();
        $this->assertTrue(Schema::hasTable('user_identities'));
        $this->assertTrue($this->passwordIsNullable());
    }

    /**
     * Read the column's nullability off the live schema rather than off the migration
     * file, so a rollback that half-applied would fail here.
     */
    private function passwordIsNullable(): bool {
        foreach (Schema::getColumns('users') as $column) {
            if ($column['name'] === 'password') {
                return $column['nullable'];
            }
        }

        return false;
    }
}
