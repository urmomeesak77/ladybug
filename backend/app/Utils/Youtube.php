<?php

declare(strict_types=1);

namespace App\Utils;

/**
 * Parse a free-form YouTube reference into a single known-good 11-char video id, or null.
 * PHP mirror of frontend/src/lib/youtube.ts (keep both in sync). Principle VI: we extract
 * only a valid id and never store or embed raw user input.
 */
class Youtube {
    /** A bare, already-valid video id. */
    private const ID = '/^[A-Za-z0-9_-]{11}$/';

    /** Id locations across the common watch / youtu.be / embed forms. */
    private const PATTERNS = [
        '/[?&]v=([A-Za-z0-9_-]{11})/',
        '#youtu\.be/([A-Za-z0-9_-]{11})#',
        '#/embed/([A-Za-z0-9_-]{11})#',
    ];

    public static function extractId(string $raw): ?string {
        $raw = trim($raw);
        if (preg_match(self::ID, $raw) === 1) {
            return $raw;
        }
        foreach (self::PATTERNS as $pattern) {
            if (preg_match($pattern, $raw, $matches) === 1) {
                return $matches[1];
            }
        }

        return null;
    }
}
