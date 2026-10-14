<?php

declare(strict_types=1);

namespace App\Http\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;

/**
 * Decompression-bomb guard for uploaded images. The 10 MB size cap bounds the FILE, not
 * the bitmap: a few-KB PNG can declare 20000x20000 pixels, which GD then allocates as
 * ~1.6 GB of truecolor memory. That is a PHP fatal past memory_limit — not a Throwable,
 * so TrashpostService's rollback never runs and a pending row plus its original file are
 * left behind. getimagesize() reads only the header, so the check itself costs nothing.
 *
 * The cap is on AREA rather than on either side so long-scroll memes stay legal.
 */
class MaxPixels implements ValidationRule {
    /**
     * 25 MP is ~100 MB decoded at GD's 4 bytes/pixel; with the largest scaled copy alive
     * beside it the peak stays well inside php.ini's 256M memory_limit.
     */
    public const DEFAULT_MAX = 25_000_000;

    public function __construct(private readonly int $maxPixels = self::DEFAULT_MAX) {
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void {
        if (!$value instanceof UploadedFile) {
            return;
        }

        // An unreadable header is the `image`/`mimes` rules' refusal, with their message.
        $info = @getimagesize((string) $value->getRealPath());
        if ($info === false) {
            return;
        }

        if ($info[0] * $info[1] > $this->maxPixels) {
            $fail('The image is too large: at most ' . ($this->maxPixels / 1_000_000) . ' megapixels are allowed.');
        }
    }
}
