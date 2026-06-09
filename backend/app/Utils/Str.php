<?php

declare(strict_types=1);

namespace App\Utils;

class Str {
    /**
     * Build a pseudo-unique, time-seeded base64 hash of the given length.
     *
     * Uniqueness is probabilistic: two calls in the same microsecond that draw
     * the same random salt could collide, so callers needing a guaranteed-unique
     * value must enforce it at the storage layer (e.g. a unique column).
     */
    public static function createUniqueHash(int $length = 10): string {
        $hash = Base64::convertDecToBase64(self::getTimeBasedUniqueNumber());

        if (strlen($hash) > $length) {
            $hash = substr($hash, 0, $length);
        }
        while (strlen($hash) < $length) {
            $hash .= Base64::convertDecToBase64(random_int(0, 63));
        }

        return $hash;
    }

    /**
     * A time-based number large enough (between 64^9 and 64^10) to seed a
     * 10-character base64 hash, salted with a small random prefix. Returned as a
     * string because it can exceed PHP_INT_MAX.
     */
    private static function getTimeBasedUniqueNumber(): string {
        [$fraction, $seconds] = explode(' ', microtime());
        $micros = (int) floor((float) $fraction * 1000000);

        return random_int(2, 114) . $seconds . $micros;
    }
}
