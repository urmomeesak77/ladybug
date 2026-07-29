<?php

declare(strict_types=1);

namespace App\Utils;

class Str {
    /**
     * Build a public hash of the given length from the URL-safe base64 alphabet
     * ([A-Za-z0-9_-]).
     *
     * The value is derived from the current microtime plus a random prefix and
     * padding, which is the prototype's generator and the one this project keeps
     * deliberately. It is therefore NOT a uniform draw over the alphabet: the
     * leading characters follow from the clock, so do not read a hash as an
     * unguessable token.
     *
     * Uniqueness is probabilistic here and enforced at the storage layer instead:
     * `trashposts.hash` and `comments.hash` are unique columns and every caller
     * retries on collision.
     */
    public static function createUniqueHash($length = 10) {

        $num = self::getTimeBasedUniqueNumber();

        $hash = Base64::convertDecToBase64($num);

        if (strlen($hash) > $length) {
            $hash = substr($hash, 0, $length);
        }
        while (strlen($hash) < $length) {
            $hash .= Base64::convertDecToBase64(rand(0, 63));
        }

        return $hash;
    }

    /**
     * @return string
     */
    protected static function getTimeBasedUniqueNumber() {
        $time = explode(' ', microtime());

        $num = $time[1] . floor($time[0] * 1000000);
        $num = rand(2, 114) . $num; //num should be between  64^9 and 64^10

        return $num;
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
