<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\AccessLogService;
use Illuminate\Console\Command;

/**
 * Delete access-log entries past the retention window (FR-027).
 *
 * Two ways to start the same routine — this command and the daily schedule entry in
 * routes/console.php — both calling AccessLogService::prune(), so there is no second
 * deletion rule that could drift from the first (FR-027b). Safe to run while the site is
 * serving traffic, and safe to run twice: a second run finds nothing and still succeeds.
 */
final class AccessLogPruneCommand extends Command {
    protected $signature = 'access-log:prune {--days= : Override the configured retention window}';

    protected $description = 'Delete access log entries older than the retention window';

    public function __construct(private readonly AccessLogService $log = new AccessLogService()) {
        parent::__construct();
    }

    public function handle(): int {
        // max(1, ...) mirrors the guard prune() enforces, so the window this line reports is
        // the window that was actually applied — a --days=0 that silently became 1 would
        // otherwise be announced as "older than 0 days", which reads like a wiped history.
        $days = max(1, (int) ($this->option('days') ?? config('access_log.retention_days')));
        $deleted = $this->log->prune($days);
        $this->info("Deleted {$deleted} access log entries older than {$days} days.");

        return self::SUCCESS;
    }
}
