<?php

declare(strict_types=1);

namespace App\Utils;

use Exception;

class Json {
    private static ?string $lastError = null;

    private static ?int $lastErrorCode = null;

    /**
     * Encode a value as JSON, optionally repairing invalid UTF-8 once before failing.
     *
     * @throws Exception when encoding fails and cannot be repaired
     */
    public static function encode(
        mixed $value,
        int $options = 0,
        int $depth = 512,
        bool $tryToFix = true
    ): string {
        $result = json_encode($value, $options, $depth);
        self::$lastErrorCode = json_last_error();
        self::$lastError = json_last_error_msg();

        return match (self::$lastErrorCode) {
            JSON_ERROR_NONE => (string) $result,
            JSON_ERROR_UTF8 => $tryToFix
                ? self::encode(self::toUtf8($value), $options, $depth, false)
                : throw new Exception(self::$lastError, self::$lastErrorCode),
            default => throw new Exception(self::$lastError, self::$lastErrorCode),
        };
    }

    /**
     * Decode a JSON string, optionally repairing invalid UTF-8 once before failing.
     *
     * @throws Exception when decoding fails and cannot be repaired
     */
    public static function decode(
        string $json,
        bool $assoc = false,
        int $depth = 512,
        int $options = 0,
        bool $tryToFix = true
    ): mixed {
        $result = json_decode($json, $assoc, $depth, $options);
        self::$lastErrorCode = json_last_error();
        self::$lastError = json_last_error_msg();

        return match (self::$lastErrorCode) {
            JSON_ERROR_NONE => $result,
            JSON_ERROR_UTF8 => $tryToFix
                ? self::decode(self::toUtf8($json), $assoc, $depth, $options, false)
                : throw new Exception(self::$lastError, self::$lastErrorCode),
            default => throw new Exception(self::$lastError, self::$lastErrorCode),
        };
    }

    public static function getLastError(): ?string {
        return self::$lastError;
    }

    public static function getLastErrorCode(): ?int {
        return self::$lastErrorCode;
    }

    /**
     * Recursively re-encode strings from ISO-8859-1 to UTF-8 so a value that
     * tripped JSON_ERROR_UTF8 can be retried. Scalars pass through unchanged.
     */
    private static function toUtf8(mixed $input): mixed {
        if (is_array($input)) {
            return array_map([self::class, 'toUtf8'], $input);
        }
        if (is_string($input)) {
            return mb_convert_encoding($input, 'UTF-8', 'ISO-8859-1');
        }
        if (is_object($input)) {
            foreach (get_object_vars($input) as $key => $value) {
                $input->$key = self::toUtf8($value);
            }
        }

        return $input;
    }
}
