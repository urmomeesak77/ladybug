<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\AccessLog;
use App\Models\User;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class AccessLogTest extends TestCase {
    use RefreshDatabase;

    public function test_the_model_maps_to_the_access_logs_table(): void {
        $this->assertSame('access_logs', (new AccessLog())->getTable());
    }

    public function test_the_table_carries_every_column_the_data_model_names(): void {
        $columns = [
            'id', 'created_at', 'remote_addr', 'forwarded_for', 'method', 'path', 'status',
            'duration_us', 'response_bytes', 'user_id', 'user_agent', 'referer',
            'query', 'input', 'body', 'cookies', 'files',
        ];

        $this->assertTrue(Schema::hasColumns('access_logs', $columns));
    }

    public function test_there_is_no_updated_at_column(): void {
        // Nothing ever updates an entry, and a column implying otherwise would invite it
        // (data-model.md). The model half of the same rule is asserted below.
        $this->assertFalse(Schema::hasColumn('access_logs', 'updated_at'));
    }

    public function test_the_model_maintains_no_timestamps(): void {
        $this->assertFalse((new AccessLog())->usesTimestamps());
    }

    public function test_the_assigned_arrival_time_survives_the_write(): void {
        // created_at is the moment the request ARRIVED, captured in the recorder's
        // before-phase — not the moment the row was written. Eloquent's automatic
        // timestamps would overwrite it with now() and quietly reorder the history.
        $arrivedAt = Carbon::parse('2026-08-14 09:15:00');

        $entry = $this->makeEntry(['created_at' => $arrivedAt]);

        $this->assertTrue($arrivedAt->equalTo($entry->fresh()->created_at));
    }

    public function test_nothing_is_mass_assignable(): void {
        // The service assigns every property directly (research D9); a machine-built row
        // has no reason to accept a request-shaped array, so the model stays fully guarded.
        $this->assertSame([], (new AccessLog())->getFillable());

        $this->expectException(MassAssignmentException::class);
        (new AccessLog())->fill(['path' => 'api/posts']);
    }

    public function test_the_parameter_maps_round_trip_as_arrays(): void {
        $entry = $this->makeEntry([
            'query' => ['page' => '2'],
            'input' => ['user' => ['email' => 'a@b.test']],
            'cookies' => ['ladybug_session' => '[redacted]'],
            'files' => [['field' => 'image', 'name' => 'meme.png', 'mime' => 'image/png', 'size' => 12]],
        ])->fresh();

        $this->assertSame(['page' => '2'], $entry->query);
        $this->assertSame(['user' => ['email' => 'a@b.test']], $entry->input);
        $this->assertSame(['ladybug_session' => '[redacted]'], $entry->cookies);
        $this->assertSame('meme.png', $entry->files[0]['name']);
    }

    public function test_the_parameter_maps_are_null_when_there_was_nothing_to_record(): void {
        $entry = $this->makeEntry()->fresh();

        $this->assertNull($entry->query);
        $this->assertNull($entry->input);
        $this->assertNull($entry->cookies);
        $this->assertNull($entry->files);
        $this->assertNull($entry->body);
    }

    public function test_user_resolves_the_account_that_made_the_request(): void {
        // Declared for a future viewer (FR-031); nothing in this feature loads it, so this
        // is the assertion that keeps it honest rather than merely present.
        $user = User::factory()->create();

        $entry = $this->makeEntry(['user_id' => $user->id])->fresh();

        $this->assertTrue($entry->user->is($user));
    }

    public function test_deleting_the_account_clears_the_reference_and_keeps_the_entry(): void {
        // FR-029: 013 hard-deletes accounts. The history must neither vanish with the
        // account nor block its deletion — the FK nulls the reference and leaves the row.
        $user = User::factory()->create();
        $entry = $this->makeEntry(['user_id' => $user->id]);

        $user->delete();

        $this->assertNotNull($entry->fresh());
        $this->assertNull($entry->fresh()->user_id);
    }

    public function test_the_six_reading_indexes_from_the_data_model_exist(): void {
        // SC-008/SC-011 are measured against real MySQL (T037), but the migration writing
        // all six index definitions is driver-independent and asserted here.
        $indexed = array_map(
            static fn (array $index): array => $index['columns'],
            Schema::getIndexes('access_logs'),
        );

        foreach ([
            ['created_at', 'id'],
            ['remote_addr', 'created_at'],
            ['forwarded_for', 'created_at'],
            ['user_id', 'created_at'],
            ['status', 'created_at'],
            ['path', 'created_at'],
        ] as $expected) {
            $this->assertContains($expected, $indexed);
        }
    }

    /**
     * A minimal entry carrying only the columns the schema requires.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function makeEntry(array $attributes = []): AccessLog {
        $entry = new AccessLog();
        $entry->created_at = Carbon::now();
        $entry->remote_addr = '203.0.113.7';
        $entry->forwarded_for = '';
        $entry->method = 'GET';
        $entry->path = 'api/posts';
        $entry->status = 200;
        $entry->duration_us = 1234;
        foreach ($attributes as $column => $value) {
            $entry->{$column} = $value;
        }
        $entry->save();

        return $entry;
    }
}
