<?php

declare(strict_types=1);

namespace Tests\Unit\Utils;

use App\Utils\Str;
use PHPUnit\Framework\TestCase;

final class StrTest extends TestCase {
    public function test_default_hash_is_ten_characters(): void {
        $this->assertSame(10, strlen(Str::createUniqueHash()));
    }

    public function test_truncates_to_a_shorter_requested_length(): void {
        $this->assertSame(5, strlen(Str::createUniqueHash(5)));
    }

    public function test_pads_up_to_a_longer_requested_length(): void {
        $this->assertSame(20, strlen(Str::createUniqueHash(20)));
    }

    public function test_only_uses_base64_url_safe_characters(): void {
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', Str::createUniqueHash(20));
    }

    /**
     * Full-alphabet uniformity is deliberately NOT asserted. The generator is
     * time-based by design (see Str::createUniqueHash), so its leading characters
     * follow the clock and never cover the alphabet evenly. What must hold is that
     * every emitted character is in the URL-safe set (Constitution V) and that the
     * value actually varies rather than being pinned to one constant.
     */
    public function test_single_char_hashes_stay_inside_the_url_safe_alphabet(): void {
        $seen = [];
        for ($i = 0; $i < 2000; $i++) {
            $seen[Str::createUniqueHash(1)] = true;
        }

        foreach (array_keys($seen) as $char) {
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]$/', (string) $char);
        }
        $this->assertGreaterThan(1, count($seen));
    }

    public function test_hashes_do_not_repeat_across_many_draws(): void {
        $draws = [];
        for ($i = 0; $i < 1000; $i++) {
            $draws[] = Str::createUniqueHash();
        }

        $this->assertSame(count($draws), count(array_unique($draws)));
    }

    public function test_leaves_a_value_shorter_than_the_limit_untouched(): void {
        $this->assertSame('short enough', Str::truncateWords('short enough', 60));
    }

    public function test_leaves_a_value_exactly_at_the_limit_untouched(): void {
        // 'twelve chars' is exactly 12 characters — the limit is inclusive, so
        // nothing is cut and no ellipsis is appended.
        $this->assertSame('twelve chars', Str::truncateWords('twelve chars', 12));
    }

    public function test_cuts_at_the_last_word_boundary_at_or_before_the_limit(): void {
        // The whole result, ellipsis included, has to fit inside the limit: the
        // budget is the meta tag's, not the text's.
        $this->assertSame('hello world…', Str::truncateWords('hello world foo', 12));
        $this->assertSame(12, mb_strlen(Str::truncateWords('hello world foo', 12)));
    }

    public function test_never_cuts_a_word_in_half(): void {
        $result = Str::truncateWords('alpha beta gamma', 13);

        $this->assertSame('alpha beta…', $result);
        $this->assertStringNotContainsString('ga…', $result);
    }

    public function test_hard_cuts_a_single_word_wider_than_the_limit(): void {
        // No boundary exists to cut at, so the limit wins over the word.
        $this->assertSame('aaaaaaaaa…', Str::truncateWords(str_repeat('a', 30), 10));
    }

    public function test_leaves_an_empty_string_untouched(): void {
        $this->assertSame('', Str::truncateWords('', 60));
    }

    public function test_keeps_text_when_the_only_boundary_precedes_the_first_word(): void {
        // The cut pattern eats the leading run of whitespace along with the
        // partial word, leaving nothing; falling back to the hard cut keeps the
        // value readable instead of collapsing it to a bare ellipsis.
        $this->assertSame('  hel…', Str::truncateWords('  hello world', 6));
    }

    public function test_counts_characters_not_bytes(): void {
        // 10 characters but 19 bytes — a byte-wise limit would truncate this.
        $this->assertSame('ёлки палки', Str::truncateWords('ёлки палки', 12));
        $this->assertSame('ёлки палки…', Str::truncateWords('ёлки палки ёжик', 12));
    }
}
