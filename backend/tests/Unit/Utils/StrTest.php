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
}
