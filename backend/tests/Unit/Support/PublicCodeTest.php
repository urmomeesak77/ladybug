<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\PublicCode;
use PHPUnit\Framework\TestCase;

final class PublicCodeTest extends TestCase {
    public function test_generate_always_produces_a_valid_code(): void {
        for ($i = 0; $i < 50; $i++) {
            $code = PublicCode::generate();
            $this->assertSame(10, strlen($code));
            $this->assertTrue(PublicCode::isValid($code));
        }
    }

    public function test_is_valid_accepts_well_formed_codes(): void {
        $this->assertTrue(PublicCode::isValid('abc12XYZ_0')); // mixed case + underscore
        $this->assertTrue(PublicCode::isValid('aB3-_xyz09'));
        $this->assertTrue(PublicCode::isValid('AAAAAAAAAA'));
        $this->assertTrue(PublicCode::isValid('----------'));
    }

    public function test_is_valid_rejects_wrong_length(): void {
        $this->assertFalse(PublicCode::isValid('ABC123XYZ')); // 9 chars
        $this->assertFalse(PublicCode::isValid('ABC123XYZ00')); // 11 chars
        $this->assertFalse(PublicCode::isValid(''));
    }

    public function test_is_valid_rejects_illegal_characters(): void {
        $this->assertFalse(PublicCode::isValid('ABC 12XYZ0')); // space
        $this->assertFalse(PublicCode::isValid('ABC.12XYZ0')); // dot
        $this->assertFalse(PublicCode::isValid('ABC/12XYZ0')); // slash
    }
}
