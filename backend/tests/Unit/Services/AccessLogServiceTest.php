<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\AccessLog;
use App\Models\User;
use App\Services\AccessLogService;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
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

    private function service(): AccessLogService {
        return $this->app->make(AccessLogService::class);
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
