<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\PublicCode;
use PHPUnit\Framework\TestCase;

final class PublicCodeTest extends TestCase
{
    public function test_generate_always_produces_a_valid_code(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $code = PublicCode::generate();
            $this->assertSame(11, strlen($code));
            $this->assertTrue(PublicCode::isValid($code));
        }
    }

    public function test_is_valid_accepts_well_formed_codes(): void
    {
        $this->assertTrue(PublicCode::isValid('ABC123XYZ-0'));
        $this->assertTrue(PublicCode::isValid('AAAAAAAAAAA'));
        $this->assertTrue(PublicCode::isValid('-----------'));
    }

    public function test_is_valid_rejects_wrong_length(): void
    {
        $this->assertFalse(PublicCode::isValid('ABC123XYZ0')); // 10 chars
        $this->assertFalse(PublicCode::isValid('ABC123XYZ-00')); // 12 chars
        $this->assertFalse(PublicCode::isValid(''));
    }

    public function test_is_valid_rejects_illegal_characters(): void
    {
        $this->assertFalse(PublicCode::isValid('abc123xyz-0')); // lowercase
        $this->assertFalse(PublicCode::isValid('ABC123XYZ_0')); // underscore
        $this->assertFalse(PublicCode::isValid('ABC 123XYZ0')); // space
    }
}
