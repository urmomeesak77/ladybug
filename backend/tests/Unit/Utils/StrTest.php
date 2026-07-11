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

    public function test_single_char_hashes_cover_the_full_charmap_including_zero(): void {
        $seen = [];
        for ($i = 0; $i < 2000; $i++) {
            $seen[Str::createUniqueHash(1)] = true;
        }

        // A uniform per-character sampler hits '0' virtually surely in 2000 draws
        // (P(miss) ≈ 2e-14); the old time-seeded big-number encoding could never
        // emit '0' as its leading character, so this pins the uniformity property.
        $this->assertArrayHasKey('0', $seen);
        $this->assertGreaterThan(60, count($seen));
    }

    public function test_hashes_do_not_repeat_across_many_draws(): void {
        $draws = [];
        for ($i = 0; $i < 1000; $i++) {
            $draws[] = Str::createUniqueHash();
        }

        $this->assertSame(count($draws), count(array_unique($draws)));
    }
}
