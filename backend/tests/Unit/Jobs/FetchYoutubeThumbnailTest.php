<?php

declare(strict_types=1);

namespace Tests\Unit\Jobs;

use App\Jobs\FetchYoutubeThumbnail;
use App\Models\Trashpost;
use App\Services\YoutubeThumbnailService;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

final class FetchYoutubeThumbnailTest extends TestCase {
    use RefreshDatabase;

    private function youtubePost(): Trashpost {
        return Trashpost::factory()->create(['type' => 'youtube', 'youtube' => 'dQw4w9WgXcQ']);
    }

    /** The job with a fake queue envelope reporting the given attempt number. */
    private function jobOnAttempt(string $hash, int $attempt): array {
        $envelope = Mockery::mock(Job::class);
        $envelope->shouldReceive('attempts')->andReturn($attempt);
        $job = new FetchYoutubeThumbnail($hash);
        $job->setJob($envelope);

        return [$job, $envelope];
    }

    private function thumbnails(?string $answer): YoutubeThumbnailService {
        $service = Mockery::mock(YoutubeThumbnailService::class);
        $service->shouldReceive('ensure')->andReturn($answer);

        return $service;
    }

    public function test_a_fetched_still_ends_the_job(): void {
        [$job, $envelope] = $this->jobOnAttempt($this->youtubePost()->hash, 1);
        $envelope->shouldNotReceive('release');

        $job->handle($this->thumbnails('/storage/still.jpg'));
        $this->assertTrue(true);
    }

    public function test_a_miss_is_retried_later_rather_than_thrown(): void {
        [$job, $envelope] = $this->jobOnAttempt($this->youtubePost()->hash, 1);
        $envelope->shouldReceive('release')->once()->with(30);

        $job->handle($this->thumbnails(null));
        $this->assertTrue(true);
    }

    public function test_the_last_miss_gives_up_quietly(): void {
        // Best-effort (FR-018): no throw, so it neither fails an upload under `sync` nor
        // lands in failed_jobs beside work an operator must act on.
        [$job, $envelope] = $this->jobOnAttempt($this->youtubePost()->hash, 3);
        $envelope->shouldNotReceive('release');

        $job->handle($this->thumbnails(null));
        $this->assertTrue(true);
    }

    public function test_a_purged_post_is_a_no_op(): void {
        [$job, $envelope] = $this->jobOnAttempt('GoneGoneGo', 1);
        $envelope->shouldNotReceive('release');
        $thumbnails = Mockery::mock(YoutubeThumbnailService::class);
        $thumbnails->shouldNotReceive('ensure');

        $job->handle($thumbnails);
        $this->assertTrue(true);
    }
}
