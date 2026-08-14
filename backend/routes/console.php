<?php

declare(strict_types=1);

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// The access log prunes itself (FR-027a): an unattended deployment has to stay bounded
// without anyone configuring host-level scheduling. 03:00 rather than midnight keeps the
// daily delete off the docs/DEPLOYMENT.md §6 backup window, so the two never contend for
// the single vCPU. What actually drives this is the `ladybug-scheduler` service in
// deploy/docker-compose.prod.yml — without a process running schedule:work the entry
// below is inert. withoutOverlapping so a run that outlives its window is not joined by
// the next one; the deletion is chunked and resumable either way (FR-027c).
if (config('access_log.prune_enabled')) {
    Schedule::command('access-log:prune')
        ->cron(config('access_log.prune_cron'))
        ->withoutOverlapping();
}
