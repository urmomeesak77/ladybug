<?php

namespace App\Utils;

class Base64 {
    static $base64Chars;

    /**
     * @param int|string $num Very large integers should be given as string. Check PHP_INT_MAX value
     *
     * @return string
     */
    public static function convertDecToBase64(int|string $num) {
        return self::convertIntToHashFromMap($num, self::getHash64Chars());
    }


    /**
     * @param $uuid
     *
     * @return string
     */
    public static function convertUuidToBase64($uuid) {
        $base64 = [];
        foreach (explode('-', $uuid) as $uuidPart) {
            $dec = hexdec($uuidPart);
            $base64[] = self::convertDecToBase64($dec);
        }

        return implode('', $base64);
    }


    /**
     * @param int|string $num       Very large integers should be given as string. Check PHP_INT_MAX value
     * @param            $charMap
     *
     * @return string
     */
    private static function convertIntToHashFromMap(int|string $num, array $charMap) {
        $hash = '';

        $base = count($charMap);

        $quotient = $num;
        do {
            $remainder = bcmod((string)$quotient, (string)$base);
            $quotient  = bcdiv((string)$quotient, (string)$base);

            $hash = $charMap[$remainder] . $hash;
        } while ($quotient > 0);
        return $hash;
    }


    /**
     * @return int[]
     */
    private static function getHash64Chars() {
        if (self::$base64Chars === null) {
            self::$base64Chars = self::generateBase64Chars();
        }
        return self::$base64Chars;
    }


    /**
     * @return int[]
     */
    private static function generateBase64Chars() {
        $chars = [0,1,2,3,4,5,6,7,8,9];
        for ($i = 65; $i <= 90;$i++) {
            $chars[] = chr($i);
        }
        for ($i = 97; $i <= 122;$i++) {
            $chars[] = chr($i);
        }
        $chars[] = '_';
        $chars[] = '-';
        return $chars;
    }
}
