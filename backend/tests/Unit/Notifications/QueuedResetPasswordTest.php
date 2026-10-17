<?php

declare(strict_types=1);

namespace Tests\Unit\Notifications;

use App\Models\User;
use App\Notifications\QueuedResetPassword;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * 024 US4 / research D7: the recovery mail is the SAME message as before, built by the
 * worker. It carries the one-time token in plaintext, so its queue row is encrypted.
 */
final class QueuedResetPasswordTest extends TestCase {
    use RefreshDatabase;

    public function test_it_is_the_framework_recovery_mail_sent_through_the_queue(): void {
        $notification = new QueuedResetPassword('token');

        $this->assertInstanceOf(ResetPassword::class, $notification);
        $this->assertInstanceOf(ShouldQueue::class, $notification);
    }

    /**
     * The serialized notification holds the plaintext token the database otherwise only
     * stores hashed — and a failed send would keep it in failed_jobs, and so in backups.
     */
    public function test_its_queue_payload_is_encrypted(): void {
        $this->assertInstanceOf(ShouldBeEncrypted::class, new QueuedResetPassword('token'));
    }

    public function test_a_failing_transport_is_retried_with_a_growing_backoff(): void {
        $notification = new QueuedResetPassword('token');

        $this->assertSame(5, $notification->tries);
        $this->assertSame([10, 60, 300, 900], $notification->backoff());
    }

    public function test_a_deleted_account_is_dropped_rather_than_mailed(): void {
        $this->assertTrue((new QueuedResetPassword('token'))->deleteWhenMissingModels);
    }

    public function test_it_builds_the_same_link_the_inline_mail_built(): void {
        $user = User::factory()->create();

        $queued = (new QueuedResetPassword('abc123'))->toMail($user);
        $inline = (new ResetPassword('abc123'))->toMail($user);

        $this->assertSame($inline->actionUrl, $queued->actionUrl);
        $this->assertStringContainsString('#token=abc123', (string) $queued->actionUrl);
    }
}
