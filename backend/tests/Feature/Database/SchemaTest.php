<?php

declare(strict_types=1);

namespace Tests\Feature\Database;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class SchemaTest extends TestCase {
    use RefreshDatabase;

    public function test_trashposts_table_has_expected_columns(): void {
        $this->assertTrue(Schema::hasTable('trashposts'));
        $this->assertTrue(Schema::hasColumns('trashposts', [
            'id', 'hash', 'title', 'type', 'file', 'youtube', 'user_id',
            'comment', 'metadata', 'created_at', 'updated_at',
            'activated_at', 'deleted_at',
        ]));
    }

    public function test_users_table_has_expected_columns(): void {
        $this->assertTrue(Schema::hasTable('users'));
        $this->assertTrue(Schema::hasColumns('users', [
            'id', 'name', 'hash', 'email', 'email_verified_at',
            'password', 'remember_token', 'created_at', 'updated_at',
        ]));
    }

    public function test_users_table_has_the_disabled_columns(): void {
        $this->assertTrue(Schema::hasColumns('users', ['disabled_at', 'disabled_by']));
    }

    public function test_users_disabled_columns_default_to_null(): void {
        // A row inserted without either column is an ACTIVE account: disabling is
        // opt-in state, so the absence of a timestamp is what "enabled" means
        // (data-model §1). A non-null default would disable every account.
        $this->insertUser('active@x.io', 'u000000003');

        $row = DB::table('users')->where('hash', 'u000000003')->first();

        $this->assertNull($row->disabled_at);
        $this->assertNull($row->disabled_by);
    }

    public function test_users_password_is_nullable(): void {
        // A Google-created account has no password at all (017 data-model §2). The
        // column loses NOT NULL, so the insert below must succeed; FR-020's guards
        // live in LoginRequest and Hash::check(), not in the schema.
        DB::table('users')->insert([
            'name' => 'Tester',
            'hash' => 'u000000010',
            'email' => 'passwordless@x.io',
            'password' => null,
        ]);

        $this->assertNull(DB::table('users')->where('hash', 'u000000010')->first()->password);
    }

    public function test_user_identities_table_has_expected_columns(): void {
        $this->assertTrue(Schema::hasTable('user_identities'));
        $this->assertTrue(Schema::hasColumns('user_identities', [
            'id', 'user_id', 'provider', 'provider_user_id', 'created_at', 'updated_at',
        ]));
    }

    public function test_user_identities_rejects_a_second_link_to_the_same_google_account(): void {
        // FR-012 direction A, as a unique index rather than an `if`: one Google
        // account links to at most one Ladybug account, and an index cannot be raced.
        $first = $this->insertUser('a@x.io', 'u000000004');
        $second = $this->insertUser('b@x.io', 'u000000005');
        $this->insertIdentity($first, '1234567890');

        $this->expectException(QueryException::class);
        $this->insertIdentity($second, '1234567890');
    }

    public function test_user_identities_rejects_a_second_google_link_on_one_account(): void {
        // FR-012 direction B: one Ladybug account links to at most one Google account.
        $user = $this->insertUser('c@x.io', 'u000000006');
        $this->insertIdentity($user, '1111111111');

        $this->expectException(QueryException::class);
        $this->insertIdentity($user, '2222222222');
    }

    public function test_user_identities_allows_the_same_subject_under_a_different_provider(): void {
        // The unique index spans (provider, provider_user_id), so the `provider`
        // column is what keeps a second provider possible later (data-model §1).
        $user = $this->insertUser('d@x.io', 'u000000007');
        $this->insertIdentity($user, '3333333333');
        $this->insertIdentity($user, '3333333333', 'github');

        $this->assertSame(2, DB::table('user_identities')->count());
    }

    public function test_user_identities_user_id_rejects_a_nonexistent_account(): void {
        $this->expectException(QueryException::class);
        $this->insertIdentity(999999, '4444444444');
    }

    public function test_user_identities_cascades_when_its_account_is_deleted(): void {
        // FR-032/INV-4: no link outlives its account. Deliberately the opposite of
        // feature 013's nullOnDelete — an ownerless link would permanently refuse
        // its own person a new account via the unique index above.
        $user = $this->insertUser('e@x.io', 'u000000008');
        $this->insertIdentity($user, '5555555555');

        DB::table('users')->where('id', $user)->delete();

        $this->assertSame(0, DB::table('user_identities')->count());
    }

    public function test_trashposts_has_a_composite_feed_index_on_activated_at_and_id(): void {
        // The feed keyset orders by (activated_at DESC, id DESC) and seeks by the
        // same tuple; without this index every page degrades to a filesort.
        $hasIndex = collect(Schema::getIndexes('trashposts'))
            ->contains(fn (array $index) => $index['columns'] === ['activated_at', 'id']);

        $this->assertTrue($hasIndex, 'trashposts needs a composite index on (activated_at, id)');
    }

    public function test_excluded_columns_are_absent(): void {
        foreach (['temp', 'oldfile', 'text', 'user'] as $column) {
            $this->assertFalse(
                Schema::hasColumn('trashposts', $column),
                "trashposts must not have the excluded column [{$column}]",
            );
        }
    }

    public function test_trashposts_hash_rejects_duplicates(): void {
        DB::table('trashposts')->insert(['hash' => 'abcdefghij']);

        $this->expectException(QueryException::class);
        DB::table('trashposts')->insert(['hash' => 'abcdefghij']);
    }

    public function test_trashposts_hash_is_case_sensitive(): void {
        DB::table('trashposts')->insert(['hash' => 'abcdefghij']);
        DB::table('trashposts')->insert(['hash' => 'ABCDEFGHIJ']);

        $this->assertSame(2, DB::table('trashposts')->count());
    }

    public function test_users_hash_rejects_duplicates(): void {
        $this->insertUser('a@x.io', 'u000000001');

        $this->expectException(QueryException::class);
        $this->insertUser('b@x.io', 'u000000001');
    }

    public function test_users_email_rejects_duplicates(): void {
        $this->insertUser('a@x.io', 'u000000001');

        $this->expectException(QueryException::class);
        $this->insertUser('a@x.io', 'u000000002');
    }

    public function test_user_id_rejects_a_nonexistent_user(): void {
        $this->expectException(QueryException::class);
        DB::table('trashposts')->insert(['hash' => 'zzzzzzzzzz', 'user_id' => 999999]);
    }

    public function test_user_id_allows_null(): void {
        DB::table('trashposts')->insert(['hash' => 'nullowner1', 'user_id' => null]);

        $this->assertSame(1, DB::table('trashposts')->whereNull('user_id')->count());
    }

    /**
     * Insert a minimal valid users row directly (bypassing the model) so the
     * schema's own constraints are what the assertions exercise. Returns the new
     * id for the callers that need one to hang a user_identities row off.
     */
    private function insertUser(string $email, string $hash): int {
        return (int) DB::table('users')->insertGetId([
            'name' => 'Tester',
            'hash' => $hash,
            'email' => $email,
            'password' => 'secret-hash',
        ]);
    }

    /**
     * Insert a link row directly, for the same reason as insertUser above.
     */
    private function insertIdentity(int $userId, string $subject, string $provider = 'google'): void {
        DB::table('user_identities')->insert([
            'user_id' => $userId,
            'provider' => $provider,
            'provider_user_id' => $subject,
        ]);
    }
}
