<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Http\Controllers\PasswordResetController;
use App\Models\User;
use App\Services\PasswordService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use ReflectionClass;
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
     * FR-012 / contracts §2: the check is a read. `DatabaseTokenRepository::exists()` is a
     * Hash::check against a SELECT, so an inbox scanner or a mail client's link preview
     * leaves the link exactly as usable as it found it — asserted against the stored row
     * rather than against a second call's answer, which would pass even if the row moved.
     */
    public function test_the_check_confirms_a_live_link_and_writes_nothing(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = Password::broker()->createToken($user);
        $before = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        $this->assertTrue($this->service()->checkResetToken(sha1($user->email), $token));

        $this->assertEquals($before, DB::table('password_reset_tokens')->where('email', $user->email)->first());
    }

    public function test_the_check_refuses_an_unknown_digest(): void {
        $this->assertFalse($this->service()->checkResetToken(sha1('nobody@example.com'), 'whatever'));
    }

    /** FR-006 / INV-4: revoked access is revoked on this route too, not only on the request one. */
    public function test_the_check_refuses_a_disabled_account(): void {
        $user = User::factory()->disabled()->create(['email' => 'revoked@example.com']);
        $token = Password::broker()->createToken($user);

        $this->assertFalse($this->service()->checkResetToken(sha1($user->email), $token));
    }

    public function test_the_check_refuses_a_token_that_does_not_match(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        Password::broker()->createToken($user);

        $this->assertFalse($this->service()->checkResetToken(sha1($user->email), str_repeat('a', 64)));
    }

    /**
     * The happy path, from the service's side: the credential is replaced and the link is
     * spent in the same breath (FR-014, data-model §4).
     */
    public function test_the_reset_writes_the_new_password_and_consumes_the_link(): void {
        $user = User::factory()->create(['email' => 'ada@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);

        $this->assertTrue($this->service()->reset(sha1($user->email), $token, 'NewPassw0rd'));

        $this->assertTrue(Hash::check('NewPassw0rd', $user->fresh()->password));
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /**
     * The `hashed` cast does the hashing (data-model §2). Assigning an already-hashed value
     * would double-hash it and lock the account out of the password it just chose — a bug no
     * "the reset returned true" assertion can see, so it is asserted here directly.
     */
    public function test_the_reset_stores_the_password_hashed_by_the_model_cast(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = Password::broker()->createToken($user);

        $this->service()->reset(sha1($user->email), $token, 'NewPassw0rd');

        $stored = (string) $user->fresh()->password;
        $this->assertNotSame('NewPassw0rd', $stored);
        $this->assertTrue(Hash::check('NewPassw0rd', $stored));
        $this->assertFalse(Hash::check($stored, $stored));
    }

    /**
     * INV-6 / FR-021: completing a reset proves possession of an inbox, not of a password,
     * so it hands out no session. The caller is told to sign in, and the SPA sends them to
     * /login.
     */
    public function test_the_reset_never_signs_the_holder_in(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = Password::broker()->createToken($user);

        $this->service()->reset(sha1($user->email), $token, 'NewPassw0rd');

        $this->assertGuest();
    }

    /**
     * INV-6 stated structurally, the way FR-004 is: the two classes on the recovery path hold
     * no sign-in call at all, so one cannot be reintroduced by an edit that "helpfully" logs
     * the holder in after a successful reset.
     */
    public function test_no_class_on_the_recovery_path_can_sign_anyone_in(): void {
        foreach ([PasswordService::class, PasswordResetController::class] as $class) {
            $source = (string) file_get_contents((string) (new ReflectionClass($class))->getFileName());

            $this->assertStringNotContainsString('Auth::login', $source, $class . ' must not sign anyone in');
            $this->assertStringNotContainsString('loginUsingId', $source, $class . ' must not sign anyone in');
        }
    }

    /**
     * The service does not judge the password: `ResetPasswordRequest` does, and it runs first
     * (contracts §3). Proving the service accepts a policy-violating value is what makes the
     * form request load-bearing rather than decorative — if the guard is ever dropped from the
     * request class, nothing below it will catch the fall.
     */
    public function test_the_service_leaves_the_password_policy_to_the_form_request(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = Password::broker()->createToken($user);

        $this->assertTrue($this->service()->reset(sha1($user->email), $token, 'short'));
    }

    public function test_the_reset_refuses_a_disabled_account_and_changes_nothing(): void {
        $user = User::factory()->disabled()->create(['email' => 'revoked@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);

        $this->assertFalse($this->service()->reset(sha1($user->email), $token, 'NewPassw0rd'));

        $this->assertTrue(Hash::check('OldPassw0rd', $user->fresh()->password));
    }

    public function test_the_reset_refuses_a_spent_link(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = Password::broker()->createToken($user);
        $this->service()->reset(sha1($user->email), $token, 'NewPassw0rd');

        $this->assertFalse($this->service()->reset(sha1($user->email), $token, 'OtherPassw0rd'));
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
