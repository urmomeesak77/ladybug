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
     * schema's own constraints are what the assertions exercise.
     */
    private function insertUser(string $email, string $hash): void {
        DB::table('users')->insert([
            'name' => 'Tester',
            'hash' => $hash,
            'email' => $email,
            'password' => 'secret-hash',
        ]);
    }
}
