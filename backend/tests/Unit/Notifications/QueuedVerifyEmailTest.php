<?php

declare(strict_types=1);

namespace Tests\Unit\Notifications;

use App\Models\User;
use App\Notifications\QueuedVerifyEmail;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * 024 US4 / research D7: the verification mail is the SAME message as before — only when
 * it is built moves, from the request to the worker.
 */
final class QueuedVerifyEmailTest extends TestCase {
    use RefreshDatabase;

    public function test_it_is_the_framework_verification_mail_sent_through_the_queue(): void {
        $notification = new QueuedVerifyEmail();

        $this->assertInstanceOf(VerifyEmail::class, $notification);
        $this->assertInstanceOf(ShouldQueue::class, $notification);
    }

    public function test_a_failing_transport_is_retried_with_a_growing_backoff(): void {
        $notification = new QueuedVerifyEmail();

        $this->assertSame(5, $notification->tries);
        $this->assertSame([10, 60, 300, 900], $notification->backoff());
    }

    /** FR-019: an account deleted before the worker gets to it is never mailed. */
    public function test_a_deleted_account_is_dropped_rather_than_mailed(): void {
        $this->assertTrue((new QueuedVerifyEmail())->deleteWhenMissingModels);
    }

    public function test_it_builds_the_same_link_the_inline_mail_built(): void {
        $this->freezeTime();
        $user = User::factory()->unverified()->create();

        $queued = (new QueuedVerifyEmail())->toMail($user);
        $inline = (new VerifyEmail())->toMail($user);

        $this->assertSame($inline->actionUrl, $queued->actionUrl);
        $this->assertSame($inline->subject, $queued->subject);
    }
}
