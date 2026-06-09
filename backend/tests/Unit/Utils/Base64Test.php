<?php

declare(strict_types=1);

namespace Tests\Unit\Utils;

use App\Utils\Base64;
use PHPUnit\Framework\TestCase;

final class Base64Test extends TestCase {
    public function test_converts_single_digit_values_to_their_map_character(): void {
        $this->assertSame('0', Base64::convertDecToBase64(0));
        $this->assertSame('A', Base64::convertDecToBase64(10));
        $this->assertSame('a', Base64::convertDecToBase64(36));
        $this->assertSame('_', Base64::convertDecToBase64(62));
        $this->assertSame('-', Base64::convertDecToBase64(63));
    }

    public function test_rolls_over_to_multiple_characters_past_the_base(): void {
        $this->assertSame('10', Base64::convertDecToBase64(64));
    }

    public function test_handles_values_beyond_php_int_max_as_string(): void {
        $code = Base64::convertDecToBase64('184467440737095516160');

        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $code);
    }

    public function test_uses_the_cached_alphabet_on_repeated_calls(): void {
        $this->assertSame(
            Base64::convertDecToBase64(1000),
            Base64::convertDecToBase64(1000)
        );
    }

    public function test_converts_uuid_segments_and_concatenates_them(): void {
        $this->assertSame(
            '00000',
            Base64::convertUuidToBase64('00000000-0000-0000-0000-000000000000')
        );
        $this->assertSame(
            'A000A',
            Base64::convertUuidToBase64('0000000a-0000-0000-0000-00000000000a')
        );
    }
}
