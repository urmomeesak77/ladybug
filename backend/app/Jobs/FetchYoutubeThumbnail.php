<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\Trashpost;
use App\Services\YoutubeThumbnailService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Downloads a YouTube post's still off the request path (024 FR-018). Still best-effort: a
 * miss is retried later, and after the last attempt the post simply keeps no still — exactly
 * what an inline failure left before.
 *
 * A miss is RELEASED, never thrown. A throw would put a best-effort fetch into failed_jobs
 * beside work an operator actually has to act on, and under the `sync` driver (tests, e2e)
 * it would propagate into the upload request itself and fail the upload.
 */
final class FetchYoutubeThumbnail implements ShouldQueue {
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    /** Seconds before each retry, indexed by the attempt that just missed. */
    private const RETRY_DELAYS = [1 => 30, 2 => 120];

    public function __construct(public readonly string $hash) {
    }

    public function handle(YoutubeThumbnailService $thumbnails): void {
        $post = Trashpost::withTrashed()->where('hash', $this->hash)->first();
        if ($post === null || $post->youtube === null || $thumbnails->ensure($post) !== null) {
            return;
        }

        $attempt = $this->attempts();
        if ($attempt < $this->tries) {
            $this->release(self::RETRY_DELAYS[$attempt] ?? 120);
        }
    }
}
