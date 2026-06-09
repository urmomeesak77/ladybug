<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The immutable public identifier for a meme (Constitution Principle V): exactly
 * 10 characters drawn from [A-Za-z0-9-_] (YouTube-style, case-sensitive). Used in
 * shareable URLs and single-meme lookups instead of the database id.
 */
final class PublicCode {
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    private const LENGTH = 10;

    private const PATTERN = '/^[A-Za-z0-9_-]{10}$/';

    public static function generate(): string {
        $lastIndex = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $lastIndex)];
        }

        return $code;
    }

    public static function isValid(string $value): bool {
        return preg_match(self::PATTERN, $value) === 1;
    }
}
