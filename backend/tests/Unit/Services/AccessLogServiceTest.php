<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\AccessLog;
use App\Models\User;
use App\Services\AccessLogService;
use DomainException;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\TestCase;

/**
 * The only writer. record() builds one row from the request and the response it produced
 * and saves it — a single INSERT, no extra round trip, no users lookup (SC-002) — and
 * contains its own failure: a broken store degrades to "answered but not recorded" and
 * never to a visitor-facing error (FR-025, research D11).
 */
final class AccessLogServiceTest extends TestCase {
    use RefreshDatabase;

    /** Whether the query listener a prune test installed has yet to fire. */
    private bool $armed = false;

    public function test_a_row_carries_everything_the_request_and_its_response_held(): void {
        $user = User::factory()->create();
        $startedAt = microtime(true) - 0.25;

        $this->service()->record($this->postRequest(), new Response('{"ok":true}', 201), $startedAt, $user->id);

        $entry = AccessLog::query()->sole();
        $this->assertSame('198.51.100.4', $entry->remote_addr);
        $this->assertSame('203.0.113.9', $entry->forwarded_for);
        $this->assertSame('POST', $entry->method);
        $this->assertSame('api/posts', $entry->path);
        $this->assertSame(201, $entry->status);
        $this->assertSame($user->id, $entry->user_id);
        $this->assertSame('curl/8.0', $entry->user_agent);
        $this->assertSame('http://ladybug.test/', $entry->referer);
        $this->assertSame(['page' => '2'], $entry->query);
        $this->assertSame(['title' => 'meme'], $entry->input);
        $this->assertSame(['ladybug_session' => 'abc'], $entry->cookies);
        $this->assertSame('image', $entry->files[0]['field']);
        $this->assertSame(strlen('{"ok":true}'), $entry->response_bytes);
    }

    public function test_the_arrival_time_and_the_elapsed_time_both_come_from_the_start_of_the_request(): void {
        // created_at is the moment the request ARRIVED, not the moment the row was written
        // (data-model.md): ordering the history by it orders requests by arrival, which is
        // what an operator reconstructing an incident expects.
        $startedAt = microtime(true) - 0.25;

        $this->service()->record($this->postRequest(), new Response('', 200), $startedAt, null);

        $entry = AccessLog::query()->sole();
        $this->assertSame((int) $startedAt, $entry->created_at->getTimestamp());
        // Sub-millisecond resolution, as an integer count of microseconds (FR-009).
        $this->assertGreaterThanOrEqual(250_000, $entry->duration_us);
        $this->assertLessThan(60_000_000, $entry->duration_us);
    }

    public function test_an_anonymous_request_records_no_account(): void {
        $this->service()->record($this->postRequest(), new Response('', 200), microtime(true), null);

        $this->assertNull(AccessLog::query()->sole()->user_id);
    }

    public function test_a_request_that_carried_no_forwarded_header_records_an_empty_claim(): void {
        // Empty string rather than NULL: "the header was absent" without the
        // three-valued-logic trap NULL brings to WHERE forwarded_for <> ... queries.
        $request = Request::create('/api/posts', 'GET', [], [], [], ['REMOTE_ADDR' => '198.51.100.4']);

        $this->service()->record($request, new Response('', 200), microtime(true), null);

        $entry = AccessLog::query()->sole();
        $this->assertSame('', $entry->forwarded_for);
        // No Referer header was sent, so nothing is recorded for it. (User-Agent gets no
        // such assertion: Request::create injects a default one, so its absence is not
        // expressible here — the middleware test drives real requests instead.)
        $this->assertNull($entry->referer);
        $this->assertNull($entry->query);
        $this->assertNull($entry->input);
        $this->assertNull($entry->files);
        $this->assertNull($entry->body);
    }

    public function test_a_form_encoded_body_is_recorded_as_parsed_fields_and_never_as_a_raw_string(): void {
        // D5/FR-005a: a raw body stored beside the parsed map would defeat US2 outright —
        // for POST /api/login it literally contains password=hunter2, and name-based
        // redaction cannot reach inside an opaque string.
        $this->service()->record($this->postRequest(), new Response('', 200), microtime(true), null);

        $entry = AccessLog::query()->sole();
        $this->assertSame(['title' => 'meme'], $entry->input);
        $this->assertNull($entry->body);
    }

    public function test_a_json_document_is_recorded_as_parsed_fields(): void {
        $request = Request::create(
            '/api/posts',
            'POST',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json', 'REMOTE_ADDR' => '198.51.100.4'],
            '{"title":"meme"}',
        );

        $this->service()->record($request, new Response('', 200), microtime(true), null);

        $entry = AccessLog::query()->sole();
        $this->assertSame(['title' => 'meme'], $entry->input);
        $this->assertNull($entry->body);
    }

    public function test_a_body_of_an_unparseable_type_is_the_only_record_there_is(): void {
        // Nothing parses it, so the raw body is all the history can hold — stored,
        // coerced and truncated (D5).
        $request = Request::create(
            '/api/posts',
            'POST',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/octet-stream', 'REMOTE_ADDR' => '198.51.100.4'],
            "raw\xB1\x31bytes",
        );

        $this->service()->record($request, new Response('', 200), microtime(true), null);

        $entry = AccessLog::query()->sole();
        $this->assertNotNull($entry->body);
        $this->assertStringContainsString('raw', $entry->body);
    }

    public function test_a_declared_content_length_is_preferred_over_measuring_the_body(): void {
        $response = new Response('{"ok":true}', 200, ['Content-Length' => '4096']);

        $this->service()->record($this->postRequest(), $response, microtime(true), null);

        $this->assertSame(4096, AccessLog::query()->sole()->response_bytes);
    }

    public function test_a_response_with_no_content_string_records_no_size(): void {
        // A StreamedResponse has no content to measure and may carry no Content-Length.
        // NULL means "not measurable", which is honest where 0 would be a lie — and the
        // callback must never be invoked to find out.
        $streamed = new StreamedResponse(function (): void {
            throw new \LogicException('the recorder must not run a streamed response to measure it');
        }, 200);

        $this->service()->record($this->postRequest(), $streamed, microtime(true), null);

        $this->assertNull(AccessLog::query()->sole()->response_bytes);
    }

    public function test_an_oversized_path_is_capped_rather_than_losing_the_whole_row(): void {
        // 'strict' => true in config/database.php turns one byte past the varchar into a
        // rejected INSERT, which looks identical to "the request was never recorded".
        $request = Request::create('/' . str_repeat('p', 3000), 'GET', [], [], [], ['REMOTE_ADDR' => '198.51.100.4']);

        $this->service()->record($request, new Response('', 404), microtime(true), null);

        $this->assertSame(2048, strlen(AccessLog::query()->sole()->path));
    }

    public function test_a_broken_store_is_reported_and_never_raised_at_the_caller(): void {
        // FR-025: the visitor's request has already been answered by the time this runs.
        // A missing table is the concrete case — the deploy window where the image is live
        // and migrate has not finished yet.
        $handler = Mockery::spy(ExceptionHandler::class);
        $this->app->instance(ExceptionHandler::class, $handler);
        Schema::drop('access_logs');

        $this->service()->record($this->postRequest(), new Response('', 200), microtime(true), null);

        $handler->shouldHaveReceived('report')->once();
    }

    public function test_deleting_the_account_clears_the_reference_and_keeps_the_entry(): void {
        // FR-029: 013 hard-deletes accounts. The history must neither vanish with the
        // account nor block its deletion — the nullOnDelete FK has to be enforced by the
        // connection, not merely declared in the migration.
        $user = User::factory()->create();
        $this->service()->record($this->postRequest(), new Response('', 200), microtime(true), $user->id);

        $user->delete();

        $entry = AccessLog::query()->sole();
        $this->assertNull($entry->user_id);
        $this->assertSame('api/posts', $entry->path);
    }

    public function test_the_written_row_resolves_the_account_that_made_the_request(): void {
        // FR-031's forward-compatible relation, exercised over a row the service wrote.
        $user = User::factory()->create();

        $this->service()->record($this->postRequest(), new Response('', 200), microtime(true), $user->id);

        $this->assertTrue(AccessLog::query()->sole()->user->is($user));
    }

    public function test_pruning_deletes_only_entries_older_than_the_window(): void {
        $this->seedEntries(1, Carbon::now()->subDays(31));
        $this->seedEntries(1, Carbon::now()->subDays(29));

        $deleted = $this->service()->prune(30);

        $this->assertSame(1, $deleted);
        $entry = AccessLog::query()->sole();
        $this->assertTrue($entry->created_at->greaterThan(Carbon::now()->subDays(30)));
    }

    public function test_pruning_loops_past_a_single_chunk_and_returns_the_total(): void {
        // A month of a busy history is far more than one pass, and FR-027 wants the whole
        // of it gone in one invocation — the loop is what makes "run it daily" enough.
        $this->seedEntries(2500, Carbon::now()->subDays(31));

        $deleted = $this->service()->prune(30);

        $this->assertSame(2500, $deleted);
        $this->assertSame(0, AccessLog::query()->count());
    }

    public function test_an_entry_exactly_on_the_boundary_is_kept(): void {
        // Strictly older, so the window is a half-open interval and the same entry cannot
        // be both inside and outside it depending on rounding.
        Carbon::setTestNow('2026-08-14 12:00:00');
        $this->seedEntries(1, Carbon::now()->subDays(30));

        $deleted = $this->service()->prune(30);

        $this->assertSame(0, $deleted);
        $this->assertSame(1, AccessLog::query()->count());
    }

    public function test_a_window_below_one_day_is_clamped_rather_than_deleting_the_whole_history(): void {
        // The same guard config/access_log.php applies to ACCESS_LOG_RETENTION_DAYS, repeated
        // here because --days= reaches prune() without passing through the config file: a
        // window of 0 would put the cutoff at now() and take the entire history with it.
        $this->seedEntries(1, Carbon::now()->subHours(2));
        $this->seedEntries(1, Carbon::now()->subDays(3));

        $deleted = $this->service()->prune(0);

        $this->assertSame(1, $deleted);
        $this->assertTrue(AccessLog::query()->sole()->created_at->greaterThan(Carbon::now()->subDay()));
    }

    public function test_the_cutoff_is_fixed_for_the_whole_run_so_a_long_prune_cannot_chase_now_forward(): void {
        // A run over a large history spans time. If the cutoff were recomputed per pass it
        // would creep forward with the clock and delete entries that were inside the window
        // when the operator started — the one way a bounded routine can lose unbounded data.
        Carbon::setTestNow('2026-08-14 12:00:00');
        $this->seedEntries(1200, Carbon::now()->subDays(40));
        $this->seedEntries(3, Carbon::now()->subDays(29));
        $this->advanceTheClockAfterTheFirstPass(5);

        $deleted = $this->service()->prune(30);

        $this->assertSame(1200, $deleted);
        // Inside the window when the run began, and a five-day jump mid-run does not change
        // that: 1203 here would mean the boundary moved.
        $this->assertSame(3, AccessLog::query()->count());
    }

    public function test_an_interrupted_run_leaves_a_consistent_history_that_the_next_run_finishes(): void {
        // FR-027c: each pass commits on its own, so a killed run has simply done less. There
        // is no half-state to repair, no cursor to resume from and no partial row.
        Carbon::setTestNow('2026-08-14 12:00:00');
        $this->seedEntries(1500, Carbon::now()->subDays(40));
        $this->seedEntries(5, Carbon::now()->subDays(2));
        $this->killTheRunAfterItsFirstPass();

        $interrupted = false;
        try {
            $this->service()->prune(30);
        }
        catch (DomainException) {
            $interrupted = true;
        }

        $this->assertTrue($interrupted, 'the run was expected to be killed after its first pass');
        // One chunk gone, the rest of the expired entries untouched and still expired, and
        // nothing newer than the cutoff harmed.
        $cutoff = Carbon::now()->subDays(30);
        $this->assertSame(500, AccessLog::query()->where('created_at', '<', $cutoff)->count());
        $this->assertSame(5, AccessLog::query()->where('created_at', '>=', $cutoff)->count());

        $deleted = $this->service()->prune(30);

        $this->assertSame(500, $deleted);
        $this->assertSame(5, AccessLog::query()->count());
    }

    private function service(): AccessLogService {
        return $this->app->make(AccessLogService::class);
    }

    /**
     * Insert $count entries dated $at.
     *
     * Straight through the query builder: the model deliberately has no $fillable, and
     * these rows exist only to be pruned — record() is what the tests above cover.
     */
    private function seedEntries(int $count, Carbon $at): void {
        $row = [
            'created_at' => $at,
            'remote_addr' => '198.51.100.4',
            'forwarded_for' => '',
            'method' => 'GET',
            'path' => 'api/posts',
            'status' => 200,
            'duration_us' => 1234,
        ];
        foreach (array_chunk(array_fill(0, $count, $row), 500) as $chunk) {
            AccessLog::query()->insert($chunk);
        }
    }

    /**
     * Jump the clock forward once the run's first pass has executed, so a per-pass cutoff
     * would visibly differ from the one the run started with.
     */
    private function advanceTheClockAfterTheFirstPass(int $days): void {
        $this->armed = true;
        DB::listen(function (QueryExecuted $query) use ($days): void {
            if ($this->armed && str_starts_with($query->sql, 'delete')) {
                $this->armed = false;
                Carbon::setTestNow(Carbon::now()->addDays($days));
            }
        });
    }

    /**
     * Kill the run the way a stopped container would — after a pass has committed, with no
     * chance to finish the loop. Disarms itself so the next run proceeds normally.
     */
    private function killTheRunAfterItsFirstPass(): void {
        $this->armed = true;
        DB::listen(function (QueryExecuted $query): void {
            if ($this->armed && str_starts_with($query->sql, 'delete')) {
                $this->armed = false;

                throw new DomainException('the pruning process was killed mid-run');
            }
        });
    }

    /**
     * A form-encoded upload carrying one of everything the row records.
     */
    private function postRequest(): Request {
        return Request::create(
            '/api/posts?page=2',
            'POST',
            ['title' => 'meme'],
            ['ladybug_session' => 'abc'],
            ['image' => UploadedFile::fake()->create('meme.gif', 1)],
            [
                'REMOTE_ADDR' => '198.51.100.4',
                'HTTP_X_FORWARDED_FOR' => '203.0.113.9',
                'HTTP_USER_AGENT' => 'curl/8.0',
                'HTTP_REFERER' => 'http://ladybug.test/',
            ],
        );
    }
}
