<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\AccessLogRedactor;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The shaping half of the redactor (US1): UTF-8 coercion so a binary payload can never cost
 * the whole row, per-value truncation at the configured limit, the column-width cap that keeps
 * a long path from being rejected by MySQL under 'strict' => true, and the file flattening
 * that keeps uploaded bytes out of the history (FR-017).
 *
 * The name-based redaction half (FR-013-FR-016) lands with US2 and is asserted here too, in
 * the same file, once it exists.
 */
final class AccessLogRedactorTest extends TestCase {
    /**
     * U+0020, U+2026, then `[truncated]` — 15 bytes. Spelled out here rather than read from
     * the class under test, so a change to the marker fails a test instead of silently
     * agreeing with itself.
     */
    private const MARKER = ' …[truncated]';

    public function test_the_marker_is_fifteen_bytes(): void {
        // Every length rule below is expressed against this, and the column-width cap
        // (rule 4) budgets it INSIDE the width — so its size is load-bearing arithmetic,
        // not decoration.
        $this->assertSame(15, strlen(self::MARKER));
    }

    public function test_a_value_over_the_limit_is_cut_at_the_limit_and_marked(): void {
        config(['access_log.value_limit' => 16]);

        $shaped = AccessLogRedactor::map(['big' => str_repeat('a', 40)]);

        $this->assertSame(str_repeat('a', 16) . self::MARKER, $shaped['big']);
        // The marker sits OUTSIDE the budget: the value is cut to the limit first and the
        // suffix appended after, so a marked value occupies value_limit + 15 bytes
        // (contracts/redaction.md -> Truncation marker).
        $this->assertSame(16 + 15, strlen($shaped['big']));
    }

    public function test_a_neighbouring_small_value_is_left_whole_and_unmarked(): void {
        // SC-005a: the asymmetry is what proves the cap is per value (FR-018a) rather than
        // shared across the entry.
        config(['access_log.value_limit' => 16]);

        $shaped = AccessLogRedactor::map(['big' => str_repeat('a', 40), 'small' => 'kept']);

        $this->assertSame('kept', $shaped['small']);
        $this->assertStringNotContainsString('[truncated]', $shaped['small']);
    }

    public function test_a_value_at_the_limit_is_not_marked(): void {
        config(['access_log.value_limit' => 16]);

        $shaped = AccessLogRedactor::map(['exact' => str_repeat('a', 16)]);

        $this->assertSame(str_repeat('a', 16), $shaped['exact']);
    }

    public function test_the_cut_lands_on_a_character_boundary(): void {
        // Cutting bytes blindly would split the third 'é' and produce exactly the invalid
        // sequence FR-019 exists to prevent.
        config(['access_log.value_limit' => 5]);

        $shaped = AccessLogRedactor::map(['v' => 'ééé']);

        $this->assertSame('éé' . self::MARKER, $shaped['v']);
        $this->assertSame('éé' . self::MARKER, mb_convert_encoding($shaped['v'], 'UTF-8', 'UTF-8'));
    }

    public function test_invalid_utf8_is_coerced_so_the_row_can_be_encoded(): void {
        // The four parameter columns are JSON and Eloquent's array cast calls json_encode,
        // which returns false on malformed UTF-8 — losing the entire entry (FR-019, D8).
        $binary = ['v' => "bad\xB1\x31byte"];

        $this->assertFalse(json_encode($binary));
        $this->assertIsString(json_encode(AccessLogRedactor::map($binary)));
    }

    public function test_non_string_scalars_are_preserved_as_they_are(): void {
        $shaped = AccessLogRedactor::map(['n' => 5, 'f' => 1.5, 'b' => true, 'z' => null]);

        $this->assertSame(['n' => 5, 'f' => 1.5, 'b' => true, 'z' => null], $shaped);
    }

    public function test_nested_values_are_shaped_at_every_depth(): void {
        // Laravel's parameter bags hold a[]=1&a[]=2 and user[name]=… as arrays, so the
        // recorded structure mirrors what was submitted — and the cap must reach into it.
        config(['access_log.value_limit' => 4]);

        $shaped = AccessLogRedactor::map(['user' => ['name' => str_repeat('a', 40), 'tags' => ['x']]]);

        $this->assertSame('aaaa' . self::MARKER, $shaped['user']['name']);
        $this->assertSame(['x'], $shaped['user']['tags']);
    }

    public function test_an_empty_map_is_recorded_as_nothing(): void {
        // NULL, not {}: an absent cookie header and an empty cookie jar are the same thing
        // to an operator, and NULL keeps the row smaller (data-model.md).
        $this->assertNull(AccessLogRedactor::map([]));
    }

    /**
     * @return array<string, array{int}>
     */
    public static function columnWidthProvider(): array {
        // The four string columns the recorder caps, at the widths the migration declares.
        return [
            'path' => [AccessLogRedactor::PATH_WIDTH],
            'forwarded_for' => [AccessLogRedactor::FORWARDED_FOR_WIDTH],
            'user_agent' => [AccessLogRedactor::USER_AGENT_WIDTH],
            'referer' => [AccessLogRedactor::REFERER_WIDTH],
        ];
    }

    #[DataProvider('columnWidthProvider')]
    public function test_a_column_cut_lands_exactly_at_the_column_width(int $width): void {
        // The opposite budgeting to the value limit, and the reason it matters:
        // config/database.php sets 'strict' => true, so one byte over the varchar rejects
        // the whole row and the entry is lost to a QueryException record() swallows
        // (data-model.md rule 4). A truncation rule that destroys what it was shaping is
        // the one failure mode this step must not have.
        $capped = AccessLogRedactor::column(str_repeat('x', $width + 100), $width);

        $this->assertSame($width, strlen($capped));
        $this->assertStringEndsWith(self::MARKER, $capped);
    }

    public function test_a_column_value_within_its_width_is_untouched_and_unmarked(): void {
        $this->assertSame('api/posts', AccessLogRedactor::column('api/posts', AccessLogRedactor::PATH_WIDTH));
    }

    public function test_a_column_value_is_coerced_and_cut_on_a_character_boundary(): void {
        $capped = AccessLogRedactor::column(str_repeat('é', 40), 24);

        $this->assertLessThanOrEqual(24, strlen($capped));
        $this->assertStringEndsWith(self::MARKER, $capped);
        $this->assertSame($capped, mb_convert_encoding($capped, 'UTF-8', 'UTF-8'));
    }

    public function test_an_absent_column_value_stays_absent(): void {
        // user_agent and referer are nullable — a request that sent neither header records
        // NULL, not an empty string.
        $this->assertNull(AccessLogRedactor::column(null, AccessLogRedactor::USER_AGENT_WIDTH));
    }

    public function test_text_shapes_a_raw_body_and_treats_an_empty_one_as_nothing(): void {
        config(['access_log.value_limit' => 8]);

        $this->assertSame('<?xml ve' . self::MARKER, AccessLogRedactor::text('<?xml version="1.0"?>'));
        $this->assertNull(AccessLogRedactor::text(''));
        $this->assertNull(AccessLogRedactor::text(null));
    }

    public function test_files_are_flattened_to_their_description_and_never_their_bytes(): void {
        // FR-017: this is why an upload at the site's 20 MiB ceiling yields a small entry
        // (SC-005) — the upload path is bounded by what is recorded, not by truncation.
        // The mime recorded is the one the CLIENT declared: resolving the real type means
        // reading the bytes, which is the one thing this must never do.
        $request = Request::create('/api/posts', 'POST', [], [], [
            'image' => UploadedFile::fake()->create('meme.gif', 3),
        ]);

        $files = AccessLogRedactor::files($request);

        $this->assertSame([
            ['field' => 'image', 'name' => 'meme.gif', 'mime' => 'image/gif', 'size' => 3 * 1024],
        ], $files);
    }

    public function test_files_nested_under_one_field_each_get_their_own_entry(): void {
        $request = Request::create('/api/posts', 'POST', [], [], [
            'docs' => [
                UploadedFile::fake()->create('a.txt', 1),
                UploadedFile::fake()->create('b.txt', 2),
            ],
        ]);

        $files = AccessLogRedactor::files($request);

        $this->assertCount(2, $files);
        $this->assertSame('docs.0', $files[0]['field']);
        $this->assertSame('docs.1', $files[1]['field']);
        $this->assertSame('b.txt', $files[1]['name']);
    }

    public function test_a_visitor_supplied_filename_is_shaped_like_any_other_value(): void {
        config(['access_log.value_limit' => 6]);

        $request = Request::create('/api/posts', 'POST', [], [], [
            'image' => UploadedFile::fake()->create(str_repeat('n', 40) . '.png', 1),
        ]);

        $files = AccessLogRedactor::files($request);

        $this->assertSame(str_repeat('n', 6) . self::MARKER, $files[0]['name']);
    }

    public function test_a_request_carrying_no_files_records_nothing(): void {
        $request = Request::create('/api/posts', 'POST', ['title' => 'hi']);

        $this->assertNull(AccessLogRedactor::files($request));
    }
}
