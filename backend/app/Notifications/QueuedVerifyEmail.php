<?php

declare(strict_types=1);

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * The framework's verification mail, built and sent by the queue worker instead of inside
 * the request (024 US4, research D7). Nothing about the message changes: the link builder
 * VerifyEmail::createUrlUsing is registered at boot (AppServiceProvider), and the worker
 * boots the same app, so it signs a byte-identical link — signed when the message is built,
 * so its lifetime runs from the send, never shorter than before.
 */
final class QueuedVerifyEmail extends VerifyEmail implements ShouldQueue {
    use Queueable;

    /** A mail server's bad minute is retried; a lasting failure lands in failed_jobs. */
    public int $tries = 5;

    /** FR-019: an account deleted before the worker gets to it is dropped, not mailed. */
    public bool $deleteWhenMissingModels = true;

    /** @return list<int> seconds before each retry */
    public function backoff(): array {
        return [10, 60, 300, 900];
    }
}
