<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\TrashpostService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Turns one staged upload into the media the feed serves (024). Deliberately thin: every
 * state transition lives in TrashpostService::processStaged / failStaged, so the request
 * path, this job and the tests share one implementation.
 *
 * A file that cannot be processed is handled INSIDE processStaged (marked failed, not
 * rethrown) and is never retried. `$tries = 2` covers only the worker itself dying
 * mid-job; when both deliveries die, failed() leaves the post failed and cleaned up.
 */
final class ProcessPostMedia implements ShouldQueue {
    use Queueable;

    public int $tries = 2;

    /** Above the slowest legitimate run; below DB_QUEUE_RETRY_AFTER (210 s). */
    public int $timeout = 180;

    /**
     * @param  bool  $autoActivate  the uploader's standing AT UPLOAD TIME (011 FR-020)
     */
    public function __construct(public readonly string $hash, public readonly bool $autoActivate) {
    }

    public function handle(TrashpostService $posts): void {
        $posts->processStaged($this->hash, $this->autoActivate);
    }

    public function failed(?Throwable $exception): void {
        app(TrashpostService::class)->failStaged($this->hash);
    }
}
