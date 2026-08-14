<?php

declare(strict_types=1);

namespace Tests\Feature\Console\Commands;

use App\Models\AccessLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * The operator's entry point to the retention window (FR-027). It is a thin wrapper over
 * AccessLogService::prune() — the same method the daily schedule calls — so there is no
 * second deletion rule that could drift from the first (FR-027b).
 */
final class AccessLogPruneCommandTest extends TestCase {
    use RefreshDatabase;

    public function test_it_deletes_only_entries_older_than_the_configured_window(): void {
        config()->set('access_log.retention_days', 30);
        $this->seedEntry(Carbon::now()->subDays(31));
        $this->seedEntry(Carbon::now()->subDays(29));

        $exit = Artisan::call('access-log:prune');

        $this->assertSame(0, $exit);
        $this->assertSame(1, AccessLog::query()->count());
    }

    public function test_it_reports_how_many_entries_it_deleted_and_the_window_it_used(): void {
        config()->set('access_log.retention_days', 30);
        $this->seedEntry(Carbon::now()->subDays(31));

        Artisan::call('access-log:prune');

        $this->assertStringContainsString('Deleted 1 access log entries older than 30 days.', Artisan::output());
    }

    public function test_a_second_run_deletes_nothing_and_still_succeeds(): void {
        // SC-007's idempotence: the daily schedule runs this on a history that is usually
        // already inside the window, and "nothing to do" is a success, not a failure.
        config()->set('access_log.retention_days', 30);
        $this->seedEntry(Carbon::now()->subDays(31));
        Artisan::call('access-log:prune');

        $exit = Artisan::call('access-log:prune');

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('Deleted 0 access log entries', Artisan::output());
    }

    public function test_the_days_option_overrides_the_configured_window(): void {
        config()->set('access_log.retention_days', 30);
        $this->seedEntry(Carbon::now()->subDays(10));
        $this->seedEntry(Carbon::now()->subDays(3));

        $exit = Artisan::call('access-log:prune', ['--days' => 7]);

        $this->assertSame(0, $exit);
        $this->assertSame(1, AccessLog::query()->count());
        $this->assertStringContainsString('older than 7 days', Artisan::output());
    }

    public function test_a_changed_retention_window_is_honoured_without_a_code_change(): void {
        // US4 scenario 3: the operator sets ACCESS_LOG_RETENTION_DAYS and redeploys; nothing
        // in the command names 30.
        config()->set('access_log.retention_days', 7);
        $this->seedEntry(Carbon::now()->subDays(10));

        Artisan::call('access-log:prune');

        $this->assertSame(0, AccessLog::query()->count());
        $this->assertStringContainsString('older than 7 days', Artisan::output());
    }

    public function test_the_prune_is_registered_on_the_daily_schedule_nobody_configured(): void {
        // US4 scenario 4 / SC-007: the entry has to be there on a deployment where the
        // operator did nothing, otherwise the history is bounded only by hand.
        Artisan::call('schedule:list');

        $listing = Artisan::output();
        $this->assertStringContainsString('access-log:prune', $listing);
        $this->assertStringContainsString('0 3 * * *', $listing);
    }

    private function seedEntry(Carbon $at): void {
        AccessLog::query()->insert([
            'created_at' => $at,
            'remote_addr' => '198.51.100.4',
            'forwarded_for' => '',
            'method' => 'GET',
            'path' => 'api/posts',
            'status' => 200,
            'duration_us' => 1234,
        ]);
    }
}
