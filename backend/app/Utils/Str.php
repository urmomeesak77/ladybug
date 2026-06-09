<?php

namespace App\Utils;

class Str {

    /**
     * There is a very very slight chance that calculated hash is not unique
     * if generated random number(out of 112) is same in same microsecond
     *
     * @param int $length
     *
     * @return string
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
    private static function getTimeBasedUniqueNumber() {
        $time = explode(' ', microtime());

        $num = $time[1] . floor($time[0] * 1000000);
        $num = rand(2, 114) . $num; //num should be between  64^9 and 64^10

        return $num;
    }
}
