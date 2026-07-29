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

    /**
     * Shorten a value to at most $limit characters, cutting at a word boundary
     * and marking the cut with a single-character ellipsis.
     *
     * The limit counts characters, not bytes, and covers the ellipsis too: the
     * budget belongs to the meta tag the value is written into, and a search
     * engine or a social card truncates on its own at a fixed width, so a value
     * that overflows is cut somewhere we did not choose.
     */
    public static function truncateWords(string $value, int $limit): string {
        if (mb_strlen($value) <= $limit) {
            return $value;
        }

        // One character over the budget, so a boundary sitting exactly at the
        // last usable position is still visible to the pattern below.
        $head = mb_substr($value, 0, $limit);
        $kept = rtrim((string) preg_replace('/\s+\S*$/u', '', $head));

        // Nothing to cut at — a single word wider than the whole limit. The
        // limit wins over the word boundary; overflowing is the worse outcome.
        if ($kept === '' || $kept === $head) {
            $kept = rtrim(mb_substr($value, 0, $limit - 1));
        }

        return $kept . '…';
    }
}
