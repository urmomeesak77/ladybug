<?php

declare(strict_types=1);

namespace App\Http\Rules;

use App\Support\FfmpegVideo;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;

/**
 * Deep content check beyond MIME sniffing (research.md #2, #5): confirms an uploaded file
 * actually decodes as a real video stream via ffprobe, catching a corrupt file or one whose
 * extension/MIME lies about its content (Edge Cases, FR-004).
 */
class ValidVideo implements ValidationRule {
    public function __construct(private readonly FfmpegVideo $ffmpeg = new FfmpegVideo()) {
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void {
        if (!$value instanceof UploadedFile) {
            return;
        }
        if ($this->ffmpeg->probe($value->getRealPath()) === null) {
            $fail('The video file is unreadable or corrupt.');
        }
    }
}
