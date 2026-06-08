<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The immutable public identifier for a meme (Constitution Principle V): exactly
 * 11 characters drawn from [A-Z0-9-]. Used in shareable URLs and single-meme
 * lookups instead of the database id.
 */
final class PublicCode
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

    private const LENGTH = 11;

    private const PATTERN = '/^[A-Z0-9-]{11}$/';

    public static function generate(): string
    {
        $lastIndex = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $lastIndex)];
        }

        return $code;
    }

    public static function isValid(string $value): bool
    {
        return preg_match(self::PATTERN, $value) === 1;
    }
}
