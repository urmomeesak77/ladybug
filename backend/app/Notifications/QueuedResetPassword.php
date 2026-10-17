<?php

declare(strict_types=1);

namespace App\Notifications;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * The framework's recovery mail, built and sent by the queue worker (024 US4, research D7).
 * The link is unchanged — ResetPassword::createUrlUsing is registered at boot, so the
 * worker builds the same `#token=` fragment link (022 contracts/recovery-link.md).
 *
 * ENCRYPTED, unlike the verification mail: the serialized notification holds the one-time
 * token in PLAINTEXT, where password_reset_tokens keeps only its hash. A send that keeps
 * failing would otherwise park a usable token in failed_jobs — and in the nightly dumps.
 */
final class QueuedResetPassword extends ResetPassword implements ShouldBeEncrypted, ShouldQueue {
    use Queueable;

    public int $tries = 5;

    /** FR-019: an account deleted before the worker gets to it is dropped, not mailed. */
    public bool $deleteWhenMissingModels = true;

    /** @return list<int> seconds before each retry */
    public function backoff(): array {
        return [10, 60, 300, 900];
    }
}
