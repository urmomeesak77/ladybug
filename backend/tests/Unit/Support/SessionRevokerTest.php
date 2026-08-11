<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Models\User;
use App\Support\SessionRevoker;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The delete `SessionRevoker` performs for FR-016/FR-028 (research D6): a single
 * statement against the `sessions` table, scoped to one account, optionally sparing
 * one row. This is deliberately not `Auth::logoutOtherDevices` (needs the plaintext
 * password the recovery route never has) or `AuthenticateSession` (a stale-hash check
 * that only fires on the next request — the row itself must be gone immediately for
 * a remembered session to stop restoring access, per D6).
 */
final class SessionRevokerTest extends TestCase {
    use RefreshDatabase;

    public function test_a_null_keep_id_deletes_every_row_for_the_account(): void {
        $user = User::factory()->create();
        $this->seedSession('session-a', $user->id);
        $this->seedSession('session-b', $user->id);

        SessionRevoker::revoke($user, null);

        $this->assertDatabaseCount('sessions', 0);
    }

    public function test_a_keep_id_spares_that_row_and_deletes_the_rest(): void {
        $user = User::factory()->create();
        $this->seedSession('session-keep', $user->id);
        $this->seedSession('session-other', $user->id);

        SessionRevoker::revoke($user, 'session-keep');

        $this->assertDatabaseHas('sessions', ['id' => 'session-keep']);
        $this->assertDatabaseMissing('sessions', ['id' => 'session-other']);
        $this->assertDatabaseCount('sessions', 1);
    }

    public function test_another_accounts_rows_are_never_touched(): void {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $this->seedSession('session-mine', $user->id);
        $this->seedSession('session-theirs', $other->id);

        SessionRevoker::revoke($user, null);

        $this->assertDatabaseHas('sessions', ['id' => 'session-theirs']);
        $this->assertDatabaseMissing('sessions', ['id' => 'session-mine']);
    }

    public function test_an_account_with_no_rows_is_a_no_op(): void {
        $user = User::factory()->create();

        SessionRevoker::revoke($user, null);

        $this->assertDatabaseCount('sessions', 0);
    }

    private function seedSession(string $id, int $userId): void {
        DB::table('sessions')->insert([
            'id' => $id,
            'user_id' => $userId,
            'ip_address' => '127.0.0.1',
            'user_agent' => 'phpunit',
            'payload' => base64_encode('irrelevant'),
            'last_activity' => time(),
        ]);
    }
}
