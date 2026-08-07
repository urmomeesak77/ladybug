<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

class PasswordResetControllerTest extends TestCase {
    use RefreshDatabase;

    /** The five account states FR-004 requires to be indistinguishable from one another. */
    private const ENUMERATION_STATES = ['enabled', 'unknown', 'disabled', 'throttled', 'mail-failure'];

    /**
     * Headers deliberately excluded from the paired comparison, each for a stated reason —
     * none of them can disclose anything about the SUBMITTED address:
     *
     * - `x-ratelimit-*` / `retry-after` count the CALLER's own traffic and are keyed by IP,
     *   never by the address in the body. `X-RateLimit-Remaining` also decrements on every
     *   request, so it can never match across 20 calls (research D7).
     * - `date` moves with the clock.
     * - `set-cookie` carries a per-request session id.
     */
    private const VOLATILE_HEADERS = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after', 'date', 'set-cookie'];

    /**
     * FR-004 / SC-003, the requirement that can only exist as a test. Five account states,
     * four paired attempts each — 20 responses — every one identical in status, body and
     * headers.
     *
     * Two things this assertion has to get right or it tests something else:
     * (a) the volatile headers above are excluded, for the reasons recorded there;
     * (b) the cap is raised, since 20 calls would otherwise trip the 5/min limit at the sixth.
     *
     * Timing is NOT compared. FR-004 covers what the server says, not how long it takes, and
     * research D12 records why equalising it was rejected.
     */
    public function test_every_account_state_answers_one_byte_identical_response(): void {
        config(['app.auth_throttle' => 1000]);
        Exceptions::fake();
        Notification::fake();

        $observed = [];
        foreach (self::ENUMERATION_STATES as $state) {
            $email = $this->prepareState($state);
            // Paired attempts: the eligible address is asked four times too, so the broker's
            // 60-second suppression is inside the comparison rather than beside it.
            for ($attempt = 1; $attempt <= 4; $attempt++) {
                $observed[$state . '#' . $attempt] = $this->comparable(
                    $this->postJson('/api/password/forgot', ['email' => $email]),
                );
            }
        }

        $this->assertCount(20, $observed);
        $first = $observed[array_key_first($observed)];
        $this->assertSame(200, $first['status']);
        foreach ($observed as $label => $signature) {
            $this->assertSame($first, $signature, "the response for {$label} differed");
        }
    }

    public function test_a_well_formed_address_always_gets_the_generic_confirmation(): void {
        Notification::fake();

        $response = $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com']);

        $response->assertOk();
        $response->assertExactJson([
            'message' => 'If an account exists for that address, a password recovery link is on its way.',
        ]);
    }

    public function test_a_missing_address_is_a_validation_error_and_sends_nothing(): void {
        Notification::fake();

        $response = $this->postJson('/api/password/forgot', []);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('email');
        Notification::assertNothingSent();
    }

    public function test_a_malformed_address_is_a_validation_error_and_sends_nothing(): void {
        Notification::fake();

        $response = $this->postJson('/api/password/forgot', ['email' => 'not-an-address']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('email');
        Notification::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /**
     * FR-010. A 429 is observably different from the generic 200, and deliberately so: the
     * bucket is keyed by requester, never by the submitted address, so it tells an attacker
     * only about their own traffic (research D7).
     */
    public function test_the_request_endpoint_refuses_past_the_cap(): void {
        config(['app.auth_throttle' => 2]);
        Notification::fake();

        $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com'])->assertOk();
        $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com'])->assertOk();

        $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com'])->assertStatus(429);
    }

    /**
     * Research D7: `password` is a SEPARATE limiter bucket from `auth`. Exhausting the
     * recovery cap must never lock the visitor out of signing in with the password they
     * do remember — which is the whole reason the cap value is shared but the bucket is not.
     */
    public function test_tripping_the_recovery_cap_leaves_signing_in_available(): void {
        config(['app.auth_throttle' => 1]);
        Notification::fake();
        User::factory()->create(['email' => 'ada@example.com', 'password' => 'Password1']);

        $this->postJson('/api/password/forgot', ['email' => 'ada@example.com'])->assertOk();
        $this->postJson('/api/password/forgot', ['email' => 'ada@example.com'])->assertStatus(429);

        $response = $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'Password1']);

        $response->assertOk();
    }

    public function test_a_real_account_is_sent_the_recovery_notification(): void {
        Notification::fake();
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $this->postJson('/api/password/forgot', ['email' => 'ada@example.com'])->assertOk();

        Notification::assertSentToTimes($user, ResetPassword::class, 1);
    }

    /**
     * The link's shape (contracts/recovery-link.md, FR-005, FR-011, FR-018). Asserted the
     * same way EmailVerificationControllerTest asserts the verification link's, so the two
     * link builders are read side by side.
     *
     * The digest is in the path and the token is after the `#`: a fragment is never sent to
     * any server, so the token cannot reach nginx's access log or Laravel's ShellController,
     * which in production serves every SPA address (research D2).
     */
    public function test_the_emailed_link_carries_the_digest_in_the_path_and_the_token_in_the_fragment(): void {
        config(['app.frontend_url' => 'http://spa.test']);
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $token = Password::broker()->createToken($user);
        $link = (new ResetPassword($token))->toMail($user)->actionUrl;

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $token);
        $this->assertSame('http://spa.test/reset-password/' . sha1($user->email) . '#token=' . $token, $link);
        $this->assertMatchesRegularExpression(
            '#^http://spa\.test/reset-password/[0-9a-f]{40}\#token=[0-9a-f]{64}$#',
            $link,
        );
    }

    public function test_the_emailed_link_prints_no_account_address(): void {
        config(['app.frontend_url' => 'http://spa.test']);
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $link = (new ResetPassword(Password::broker()->createToken($user)))->toMail($user)->actionUrl;

        // FR-011: no page in the journey prints an account detail — not the body, and not
        // the address bar either, which a plaintext ?email= would.
        $this->assertStringNotContainsString($user->email, $link);
        $this->assertStringNotContainsString(rawurlencode($user->email), $link);
    }

    /**
     * FR-005: exactly one link and no password. The action URL is the one link; every line
     * the recipient reads is checked to hold no second URL.
     */
    public function test_the_message_carries_exactly_one_link(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $mail = (new ResetPassword('a1b2c3'))->toMail($user);

        $this->assertNotEmpty($mail->actionUrl);
        foreach (array_merge($mail->introLines, $mail->outroLines) as $line) {
            $this->assertStringNotContainsString('http', $line);
        }
    }

    /**
     * The message's stated lifetime and the enforced one read the same config key, so the
     * email cannot promise a window the broker does not honour.
     */
    public function test_the_message_states_the_configured_expiry(): void {
        config(['auth.passwords.users.expire' => 45]);
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $mail = (new ResetPassword('a1b2c3'))->toMail($user);

        $this->assertStringContainsString('45 minutes', implode(' ', $mail->outroLines));
    }

    /**
     * The parts of a response FR-004 governs: status, body, and every header that is not
     * excluded above. Header names are lower-cased so the comparison does not depend on
     * how the framework happened to capitalise them.
     *
     * @return array{status: int, body: string, headers: array<string, mixed>}
     */
    private function comparable(TestResponse $response): array {
        $headers = [];
        foreach ($response->headers->all() as $name => $values) {
            if (! in_array(strtolower($name), self::VOLATILE_HEADERS, true)) {
                $headers[strtolower($name)] = $values;
            }
        }
        ksort($headers);

        return [
            'status' => $response->getStatusCode(),
            'body' => $response->getContent(),
            'headers' => $headers,
        ];
    }

    /** Put one account state in place and return the address to submit for it. */
    private function prepareState(string $state): string {
        return match ($state) {
            'enabled' => User::factory()->create(['email' => 'enabled@example.com'])->email,
            'unknown' => 'nobody@example.com',
            'disabled' => User::factory()->disabled()->create(['email' => 'revoked@example.com'])->email,
            'throttled' => $this->addressAlreadyInsideTheResendInterval(),
            'mail-failure' => $this->addressWhoseMailerThrows(),
        };
    }

    /** An address whose token row was minted just now, so the broker suppresses a re-send (FR-009). */
    private function addressAlreadyInsideTheResendInterval(): string {
        $user = User::factory()->create(['email' => 'throttled@example.com']);
        Password::broker()->createToken($user);

        return $user->email;
    }

    /**
     * A real, enabled account whose mail transport fails (FR-032). Installed last in the
     * state roster, because the mock stays in place for the rest of the test.
     */
    private function addressWhoseMailerThrows(): string {
        $user = User::factory()->create(['email' => 'unreachable@example.com']);
        $this->mock(NotificationDispatcher::class, static function ($mock): void {
            $mock->shouldReceive('send')->andThrow(new RuntimeException('mail transport down'));
        });

        return $user->email;
    }
}
