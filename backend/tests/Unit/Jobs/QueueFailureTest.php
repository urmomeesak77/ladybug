<?php

declare(strict_types=1);

namespace Tests\Unit\Jobs;

use App\Jobs\FetchYoutubeThumbnail;
use App\Jobs\ProcessPostMedia;
use App\Models\Trashpost;
use App\Models\User;
use App\Services\YoutubeThumbnailService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

/**
 * 024 US5: what an operator finds in failed_jobs. Run through the REAL database queue and
 * worker (not Queue::fake, not sync), so the retries, the backoff and the final
 * hand-off to failed_jobs are the framework's own, exactly as in production.
 *
 * The rule being proven: failed_jobs holds only what an operator can act on. A mail that
 * keeps failing lands there; a media file that cannot be processed does NOT — the post is
 * marked failed and the uploader is told — and neither does a best-effort YouTube still.
 */
final class QueueFailureTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        config(['queue.default' => 'database']);
    }

    /** One worker pass per attempt, an hour apart so every backoff has elapsed. */
    private function work(int $passes): void {
        for ($pass = 1; $pass <= $passes; $pass++) {
            $this->artisan('queue:work', ['connection' => 'database', '--once' => true, '--stop-when-empty' => true]);
            $this->travel(1)->hours();
        }
    }

    public function test_a_mail_that_keeps_failing_ends_in_failed_jobs_once(): void {
        // An undefined mailer: every delivery attempt throws, as a dead mail server would.
        config(['mail.default' => 'unreachable']);
        $user = User::factory()->unverified()->create();

        $user->sendEmailVerificationNotification();
        $this->work(6);

        $this->assertSame(1, DB::table('failed_jobs')->count());
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function test_a_file_that_cannot_be_processed_fails_the_post_not_the_job(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->hidden()->create();
        $post->media_state = Trashpost::MEDIA_PROCESSING;
        $post->media_source = "staging/{$post->hash}";
        $post->save();
        Storage::disk('local')->put("staging/{$post->hash}", 'not an image at all');

        ProcessPostMedia::dispatch((string) $post->hash, false);
        $this->work(3);

        $this->assertSame(Trashpost::MEDIA_FAILED, $post->fresh()->media_state);
        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function test_a_youtube_still_that_never_arrives_is_given_up_quietly(): void {
        $post = Trashpost::factory()->visible()->create(['youtube' => 'dQw4w9WgXcQ']);
        $thumbnails = Mockery::mock(YoutubeThumbnailService::class);
        $thumbnails->shouldReceive('ensure')->times(3)->andReturn(null);
        $this->app->instance(YoutubeThumbnailService::class, $thumbnails);

        FetchYoutubeThumbnail::dispatch((string) $post->hash);
        $this->work(4);

        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertSame(0, DB::table('jobs')->count());
    }
}
