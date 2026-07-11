<?php

declare(strict_types=1);

namespace App\Utils;

class Str {
    /**
     * Build a random public hash of the given length from the URL-safe base64
     * alphabet ([A-Za-z0-9_-]).
     *
     * Each character is an independent uniform draw via random_int (a CSPRNG),
     * so a 10-char hash carries ~60 bits of entropy and is NOT derivable from
     * the post's creation time — the API exposes created_at to the second, so a
     * time-seeded hash would leave only the salt to guess (Principle V opacity).
     *
     * Uniqueness stays probabilistic: callers needing a guaranteed-unique value
     * must enforce it at the storage layer (e.g. a unique column) — all current
     * callers do, with a retry loop on collision.
     */
    public static function createUniqueHash(int $length = 10): string {
        $hash = '';
        for ($i = 0; $i < $length; $i++) {
            $hash .= Base64::convertDecToBase64(random_int(0, 63));
        }

        return $hash;
    }
}
