<?php

namespace App\Utils;

class Json {
    private static $lastError;
    private static $lastErrorCode;

    public static function encode($value, $options = 0, $depth = 512, $tryToFix = true) {
        try {
            $result = json_encode($value, $options);
            self::$lastErrorCode = json_last_error();
            self::$lastError = json_last_error_msg();
        }
        catch (\Exception $e) {
            self::$lastErrorCode = $e->getCode();
            self::$lastError = $e->getMessage();
        }

        switch (self::$lastErrorCode) {
            case (JSON_ERROR_NONE):
                return $result;
            case (JSON_ERROR_UTF8):
                if ($tryToFix) {
                    $value = self::utf8Input($value);
                    return self::encode($value, $options, $depth, false);
                }
        default:
            throw new \Exception(self::getLastError() , self::getLastErrorCode());
        }
    }

    /**
    * @param       $json
    * @param false $assoc
    * @param int   $depth
    * @param int   $options
    * @param bool  $tryToFix
    *
    * @return mixed
    * @throws \Exception
    */
    public static function decode($json, $assoc = false, $depth = 512, $options = 0, $tryToFix = true) {
        try {
            $result = json_decode($json, $assoc, $depth, $options);
            self::$lastErrorCode = json_last_error();
            self::$lastError = json_last_error_msg();
        }
        catch (\Exception $e) {
            self::$lastErrorCode = $e->getCode();
            self::$lastError = $e->getMessage();
        }

        switch (self::$lastErrorCode) {
            case (JSON_ERROR_NONE):
                return $result;
        case (JSON_ERROR_UTF8):
            if ($tryToFix) {
                $json = utf8_encode($json);
                return self::decode($json, $assoc, $depth, $options, false);
            }
        default:
            throw new \Exception(self::getLastError() , self::getLastErrorCode());
        }
    }


    public static function getLastError() {
        return self::$lastError;
    }


    public static function getLastErrorCode() {
        return self::$lastErrorCode;
    }


    private static function utf8Input($input) {
        if (is_array($input)) {
            foreach ($input as $key => $value) {
                $input[$key] = self::utf8Input($value);
            }
        }
        elseif (is_string($input)) {
            $input = utf8_encode($input);
        }
        elseif (is_object($input)) {
            $vars = array_keys(get_object_vars($input));

            foreach ($vars as $var) {
                $input->$var = self::utf8Input($input->$var);
            }
        }

        return $input;
    }
}
