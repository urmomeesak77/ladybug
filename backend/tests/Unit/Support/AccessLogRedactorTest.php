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
 * The name-based redaction half (FR-013-FR-016) is asserted here too, below the shaping
 * cases: the same class owns both, because the ORDER between them is load-bearing.
 */
final class AccessLogRedactorTest extends TestCase {
    /**
     * U+0020, U+2026, then `[truncated]` — 15 bytes. Spelled out here rather than read from
     * the class under test, so a change to the marker fails a test instead of silently
     * agreeing with itself.
     */
    private const MARKER = ' …[truncated]';

    /** Spelled out for the same reason as MARKER — the test must not agree with itself. */
    private const REDACTED = '[redacted]';

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

    // --- The redaction half (US2, FR-013-FR-016) ---------------------------------------

    /**
     * The full default list from contracts/redaction.md. Asserting it here rather than
     * reading config('access_log.sensitive') back is the point: a name silently dropped
     * from the config file fails a test instead of quietly widening what comes to rest.
     *
     * @return array<string, array{string}>
     */
    public static function sensitiveNameProvider(): array {
        return [
            'password' => ['password'],
            'password_confirmation' => ['password_confirmation'],
            'current_password' => ['current_password'],
            'new_password' => ['new_password'],
            // Load-bearing today, not defensive: 022's reset token is submitted as a FORM
            // FIELD on every reset and every link-validity probe. The fragment keeps it out
            // of URLs, not out of bodies (contracts/redaction.md).
            'token' => ['token'],
            '_token' => ['_token'],
            'remember_token' => ['remember_token'],
            'api_token' => ['api_token'],
            'access_token' => ['access_token'],
            'refresh_token' => ['refresh_token'],
            'id_token' => ['id_token'],
            'secret' => ['secret'],
            'client_secret' => ['client_secret'],
            'authorization' => ['authorization'],
            // 008's signed verification links carry their signature in the query string.
            'signature' => ['signature'],
            'code' => ['code'],
            'state' => ['state'],
            'credential' => ['credential'],
        ];
    }

    #[DataProvider('sensitiveNameProvider')]
    public function test_every_default_sensitive_name_is_withheld(string $name): void {
        $shaped = AccessLogRedactor::map([$name => 'the secret']);

        $this->assertSame(self::REDACTED, $shaped[$name]);
    }

    public function test_a_withheld_value_is_replaced_and_never_removed(): void {
        // FR-014: a removed key would be indistinguishable from a field that was never
        // submitted, so an operator could not tell a credential-less request from one whose
        // credential was withheld.
        $shaped = AccessLogRedactor::map(['email' => 'ada@example.com', 'password' => 'hunter2']);

        $this->assertSame(['email' => 'ada@example.com', 'password' => self::REDACTED], $shaped);
    }

    public function test_matching_is_case_insensitive_on_the_key(): void {
        // Nothing forces a client to spell a field the way the framework does, and PHP array
        // keys are case-sensitive, so all three of these can arrive side by side.
        $shaped = AccessLogRedactor::map(['Password' => 'a', 'PASSWORD' => 'b', 'pAsSwOrD' => 'c']);

        $this->assertSame(['Password' => self::REDACTED, 'PASSWORD' => self::REDACTED, 'pAsSwOrD' => self::REDACTED], $shaped);
    }

    public function test_a_prefixed_name_is_withheld(): void {
        // Laravel's recaller cookie is remember_web_<sha1 of the guard name> — a
        // per-deployment name that cannot be listed exactly, which is what the prefix
        // list exists for.
        $shaped = AccessLogRedactor::map(['remember_web_' . sha1('web') => 'id|token|hash']);

        $this->assertSame(self::REDACTED, $shaped['remember_web_' . sha1('web')]);
    }

    public function test_a_prefix_matches_only_at_the_start_of_the_name(): void {
        // Prefix, not substring: FR-016 keeps everything not listed, and a substring rule
        // would start withholding fields nobody put on the list.
        $shaped = AccessLogRedactor::map(['do_remember_web_choice' => 'yes']);

        $this->assertSame('yes', $shaped['do_remember_web_choice']);
    }

    public function test_redaction_reaches_every_nesting_depth(): void {
        // FR-015 rule 4: user[password] and a nested JSON document are covered as thoroughly
        // as a flat field, or the rule is one rename away from being bypassed.
        $shaped = AccessLogRedactor::map([
            'user' => ['name' => 'Ada', 'password' => 'hunter2'],
            'form' => ['meta' => ['_token' => 'the csrf token']],
        ]);

        $this->assertSame(['name' => 'Ada', 'password' => self::REDACTED], $shaped['user']);
        $this->assertSame(self::REDACTED, $shaped['form']['meta']['_token']);
    }

    public function test_a_withheld_key_holding_a_structure_is_withheld_whole(): void {
        // Recursing INTO a matched key would record its leaves — password[first] and
        // password[second] are still the password.
        $shaped = AccessLogRedactor::map(['password' => ['first' => 'a', 'second' => 'b']]);

        $this->assertSame(self::REDACTED, $shaped['password']);
    }

    public function test_an_oversized_secret_is_withheld_before_anything_can_truncate_it(): void {
        // The fixed redact -> coerce -> truncate order, proven rather than described: with
        // truncation first, a 100 KB password would come to rest as a 64 KB PARTIAL password
        // (contracts/redaction.md -> Ordering).
        config(['access_log.value_limit' => 65536]);

        $shaped = AccessLogRedactor::map(['password' => str_repeat('s', 100_000)]);

        // Length before identity, deliberately: if this regresses, the stored value IS the
        // 64 KB partial secret, and a failure diff of it would bury the whole run.
        $this->assertLessThan(100, strlen($shaped['password']));
        $this->assertSame(self::REDACTED, $shaped['password']);
    }

    public function test_names_that_are_not_listed_are_recorded_in_full(): void {
        // FR-016 is what makes the history diagnostically useful, and FR-008b rests on the
        // submitted identifier surviving: it is what names the actor on a sign-in row, where
        // user_id is deliberately NULL.
        $shaped = AccessLogRedactor::map([
            'email' => 'ada@example.com',
            'name' => 'Ada',
            'title' => 'a meme title',
            'cursor' => 'aBcDeFgHiJ',
        ]);

        $this->assertSame([
            'email' => 'ada@example.com',
            'name' => 'Ada',
            'title' => 'a meme title',
            'cursor' => 'aBcDeFgHiJ',
        ], $shaped);
    }

    public function test_the_per_deployment_cookie_names_are_resolved_from_config(): void {
        // config/remember.php derives its cookie name from APP_NAME and config/session.php
        // from APP_NAME too, so a hard-coded literal would stop matching on a deployment that
        // renamed the app — a redaction rule that fails open is worse than no rule. These
        // names are deliberately NOT the defaults.
        config(['session.cookie' => 'renamed_session', 'remember.cookie' => 'renamed-remember']);

        $shaped = AccessLogRedactor::map([
            'renamed_session' => 'the session id an operator could impersonate with',
            'XSRF-TOKEN' => 'the csrf token',
            'renamed-remember' => '1',
            'taste' => 'vanilla',
        ]);

        $this->assertSame(self::REDACTED, $shaped['renamed_session']);
        $this->assertSame(self::REDACTED, $shaped['XSRF-TOKEN']);
        $this->assertSame(self::REDACTED, $shaped['renamed-remember']);
        $this->assertSame('vanilla', $shaped['taste']);
    }

    public function test_a_map_of_nothing_but_secrets_is_still_recorded_as_a_map(): void {
        // The entry must show that a request carried these fields at all — NULL here would
        // read as "submitted nothing", which is a different fact (FR-014).
        $this->assertSame(['password' => self::REDACTED], AccessLogRedactor::map(['password' => 'hunter2']));
    }
}
