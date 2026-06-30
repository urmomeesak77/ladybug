<?php

declare(strict_types=1);

namespace App\Utils;

class Base64 {
    /** @var (int|string)[]|null */
    private static ?array $base64Chars = null;

    /**
     * Convert a non-negative integer to a URL-safe base64 string.
     *
     * @param int|string $num Very large integers must be given as a string (see PHP_INT_MAX)
     */
    public static function convertDecToBase64(int|string $num): string {
        return self::convertIntToHashFromMap($num, self::getHash64Chars());
    }

    /**
     * Encode each dash-separated UUID segment and concatenate the results.
     */
    public static function convertUuidToBase64(string $uuid): string {
        $base64 = [];
        foreach (explode('-', $uuid) as $uuidPart) {
            $base64[] = self::convertDecToBase64(hexdec($uuidPart));
        }

        return implode('', $base64);
    }

    /**
     * @param int|string     $num     Very large integers must be given as a string
     * @param (int|string)[] $charMap
     */
    private static function convertIntToHashFromMap(int|string $num, array $charMap): string {
        $hash = '';
        $base = count($charMap);

        // bcmath keeps the math exact for values beyond PHP_INT_MAX
        $quotient = (string) $num;
        do {
            $remainder = bcmod($quotient, (string) $base);
            $quotient = bcdiv($quotient, (string) $base);

            $hash = $charMap[(int) $remainder] . $hash;
        }
        while (bccomp($quotient, '0') > 0);

        return $hash;
    }

    /**
     * @return (int|string)[]
     */
    private static function getHash64Chars(): array {
        if (self::$base64Chars === null) {
            self::$base64Chars = self::generateBase64Chars();
        }

        return self::$base64Chars;
    }

    /**
     * @return (int|string)[] the 64 characters used to build a hash
     */
    private static function generateBase64Chars(): array {
        $chars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        for ($i = 65; $i <= 90; $i++) {
            $chars[] = chr($i);
        }
        for ($i = 97; $i <= 122; $i++) {
            $chars[] = chr($i);
        }
        $chars[] = '_';
        $chars[] = '-';

        return $chars;
    }
}
