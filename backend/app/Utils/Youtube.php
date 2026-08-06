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

    /**
     * The Shorts path form, held on its own so extraction and isShort() answer from one
     * pattern and cannot drift. Host-agnostic like the /embed/ entry: the same clip is
     * shared from youtube.com, www. and m. hosts alike.
     */
    private const SHORTS = '#/shorts/([A-Za-z0-9_-]{11})#';

    /** Id locations across the common watch / youtu.be / embed / shorts forms. */
    private const PATTERNS = [
        '/[?&]v=([A-Za-z0-9_-]{11})/',
        '#youtu\.be/([A-Za-z0-9_-]{11})#',
        '#/embed/([A-Za-z0-9_-]{11})#',
        self::SHORTS,
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

    /**
     * Whether the raw input was specifically a Shorts URL. Asked at upload time because
     * that is the only moment the shape is knowable — extractId() keeps the bare id and
     * discards the URL it came from — and the answer decides 9:16 vs 16:9 playback.
     * Requires the real /shorts/{11-char-id} path, so a string that merely mentions
     * "shorts" is not a Short.
     */
    public static function isShort(string $raw): bool {
        return preg_match(self::SHORTS, trim($raw)) === 1;
    }
}
