<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\PasswordService;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * The whole "forgot password" decision, run by the worker (024 FR-004, research D7).
 *
 * Queueing only the MAIL would not be enough: the broker still looks the account up and
 * hashes and stores a token for a real one, so a real address would keep answering slower
 * than an unknown one. The request therefore queues THIS job for every address — one
 * identical insert either way — and the lookup, token and mail all happen here, through
 * the unchanged PasswordService::sendRecoveryLink.
 *
 * Encrypted because the payload is the submitted address — personal data that would
 * otherwise sit readable in the jobs and failed_jobs tables.
 */
final class SendRecoveryLink implements ShouldBeEncrypted, ShouldQueue {
    use Queueable;

    /** sendRecoveryLink swallows mail failures itself; these cover the database blinking. */
    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60];

    public function __construct(public readonly string $email) {
    }

    public function handle(PasswordService $passwords): void {
        $passwords->sendRecoveryLink($this->email);
    }
}
