<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\User;
use App\Services\PasswordService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Notification;
use ReflectionMethod;
use RuntimeException;
use Tests\TestCase;

/**
 * The single collapse point FR-004 rests on (research D4). Every case below asserts one
 * of two things: that the eligible path does exactly one thing, or that an ineligible
 * path does nothing at all — and that the caller cannot tell which happened, because
 * sendRecoveryLink() has no return value to tell it with.
 */
class PasswordServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): PasswordService {
        return $this->app->make(PasswordService::class);
    }

    public function test_an_enabled_account_gets_one_notification_and_one_token_row(): void {
        Notification::fake();
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $this->service()->sendRecoveryLink('ada@example.com');

        Notification::assertSentToTimes($user, ResetPassword::class, 1);
        $this->assertDatabaseHas('password_reset_tokens', ['email' => 'ada@example.com']);
    }

    /**
     * FR-019, first half: an account created through Google has `password IS NULL`, and the
     * broker resolves accounts by address without ever inspecting the stored credential. A
     * null password must therefore neither block the send nor change a single word of the
     * message — the wording is compared against a password account's rather than against a
     * repeated literal, so a divergence in either has to fail here.
     */
    public function test_a_google_only_account_gets_the_same_notification_with_the_same_wording(): void {
        Notification::fake();
        $google = User::factory()->googleOnly()->create(['email' => 'grace@example.com']);
        $ordinary = User::factory()->create(['email' => 'ada@example.com']);

        $this->service()->sendRecoveryLink('grace@example.com');

        Notification::assertSentToTimes($google, ResetPassword::class, 1);
        $this->assertDatabaseHas('password_reset_tokens', ['email' => 'grace@example.com']);
        $this->assertSame($this->wordingFor($ordinary), $this->wordingFor($google));
    }

    public function test_an_unknown_address_sends_nothing(): void {
        Notification::fake();

        $this->service()->sendRecoveryLink('nobody@example.com');

        Notification::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /**
     * FR-006. The broker cannot see `disabled_at` — EloquentUserProvider knows only
     * credentials — so the exclusion has to live above it, in the service (research D4).
     */
    public function test_a_disabled_account_sends_nothing(): void {
        Notification::fake();
        User::factory()->disabled()->create(['email' => 'revoked@example.com']);

        $this->service()->sendRecoveryLink('revoked@example.com');

        Notification::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /**
     * FR-009: at most one send per address per `auth.passwords.users.throttle` seconds.
     * The second call is suppressed by the broker, and the service reports it exactly as
     * it reports success — that is, not at all.
     */
    public function test_a_second_request_inside_the_resend_interval_sends_nothing_more(): void {
        Notification::fake();
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $this->service()->sendRecoveryLink('ada@example.com');
        $this->service()->sendRecoveryLink('ada@example.com');

        Notification::assertSentToTimes($user, ResetPassword::class, 1);
    }

    /**
     * FR-032 / research D5: the same shape registration already uses for its verification
     * mail. Not catching would produce a 500 for a real account and a 200 for an unknown
     * one — the sharpest enumeration oracle the feature could ship.
     */
    public function test_a_mail_transport_failure_is_reported_and_swallowed(): void {
        Exceptions::fake();
        User::factory()->create(['email' => 'ada@example.com']);
        $this->mock(NotificationDispatcher::class, static function ($mock): void {
            $mock->shouldReceive('send')->andThrow(new RuntimeException('mail transport down'));
        });

        $this->service()->sendRecoveryLink('ada@example.com');

        Exceptions::assertReported(RuntimeException::class);
    }

    /**
     * The type system carries FR-004, not a convention: there is no status for a controller
     * to branch on, so the enumeration oracle cannot be reintroduced by a later edit
     * (research D4). If this assertion ever fails, read D4 before "fixing" it.
     */
    public function test_the_send_reports_no_outcome_at_all(): void {
        $returnType = (new ReflectionMethod(PasswordService::class, 'sendRecoveryLink'))->getReturnType();

        $this->assertNotNull($returnType);
        $this->assertSame('void', (string) $returnType);
    }

    /**
     * The message's own words, with the link excluded: the action URL necessarily differs
     * between two accounts (different digest, different token), while everything the
     * recipient reads must not.
     *
     * @return array<string, mixed>
     */
    private function wordingFor(User $user): array {
        $mail = (new ResetPassword('a1b2c3'))->toMail($user);

        return [
            'subject' => $mail->subject,
            'intro' => $mail->introLines,
            'action' => $mail->actionText,
            'outro' => $mail->outroLines,
        ];
    }
}
