<?php

declare(strict_types=1);

namespace Tests\Unit\Jobs;

use App\Jobs\SendRecoveryLink;
use App\Models\User;
use App\Notifications\QueuedResetPassword;
use App\Services\PasswordService;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * 024 FR-004: the whole recovery decision — lookup, token, mail — runs here, off the
 * request, so the request does identical work for every address. The decision itself is
 * the unchanged PasswordService::sendRecoveryLink, proven in PasswordServiceTest.
 */
final class SendRecoveryLinkTest extends TestCase {
    use RefreshDatabase;

    private function handle(string $email): void {
        (new SendRecoveryLink($email))->handle($this->app->make(PasswordService::class));
    }

    public function test_a_real_enabled_account_is_sent_the_recovery_mail(): void {
        Notification::fake();
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $this->handle('ada@example.com');

        Notification::assertSentToTimes($user, QueuedResetPassword::class, 1);
        $this->assertDatabaseHas('password_reset_tokens', ['email' => 'ada@example.com']);
    }

    public function test_an_unknown_address_sends_nothing_and_stores_nothing(): void {
        Notification::fake();

        $this->handle('nobody@example.com');

        Notification::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_a_disabled_account_sends_nothing_and_stores_nothing(): void {
        Notification::fake();
        User::factory()->disabled()->create(['email' => 'revoked@example.com']);

        $this->handle('revoked@example.com');

        Notification::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /** The submitted address is personal data sitting in the jobs (and failed_jobs) table. */
    public function test_it_is_queued_with_an_encrypted_payload(): void {
        $job = new SendRecoveryLink('ada@example.com');

        $this->assertInstanceOf(ShouldQueue::class, $job);
        $this->assertInstanceOf(ShouldBeEncrypted::class, $job);
    }

    public function test_a_database_hiccup_is_retried_a_few_times(): void {
        $job = new SendRecoveryLink('ada@example.com');

        $this->assertSame(3, $job->tries);
        $this->assertSame([10, 60], $job->backoff);
    }
}
