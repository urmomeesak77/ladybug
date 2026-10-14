<?php

declare(strict_types=1);

namespace Tests\Unit\Jobs;

use App\Jobs\ProcessPostMedia;
use App\Services\TrashpostService;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * The job is wiring only: every state transition is TrashpostService's and is proven there
 * (TrashpostServiceTest, the "024: staged uploads" block). This proves the hand-off.
 */
final class ProcessPostMediaTest extends TestCase {
    public function test_handle_processes_the_staged_upload_with_the_upload_time_decision(): void {
        $posts = Mockery::mock(TrashpostService::class);
        $posts->shouldReceive('processStaged')->once()->with('AbCdEfGhIj', true);

        (new ProcessPostMedia('AbCdEfGhIj', true))->handle($posts);
        $this->assertTrue(true);
    }

    public function test_a_job_that_gave_up_leaves_the_post_failed(): void {
        $posts = Mockery::mock(TrashpostService::class);
        $posts->shouldReceive('failStaged')->once()->with('AbCdEfGhIj');
        $this->app->instance(TrashpostService::class, $posts);

        (new ProcessPostMedia('AbCdEfGhIj', false))->failed(new RuntimeException('worker died'));
        $this->assertTrue(true);
    }

    public function test_the_job_retries_only_a_dead_worker_and_stays_inside_retry_after(): void {
        $job = new ProcessPostMedia('AbCdEfGhIj', false);

        $this->assertSame(2, $job->tries);
        // Below DB_QUEUE_RETRY_AFTER (210 s), or a still-running job is handed out twice.
        $this->assertLessThan(210, $job->timeout);
    }
}
