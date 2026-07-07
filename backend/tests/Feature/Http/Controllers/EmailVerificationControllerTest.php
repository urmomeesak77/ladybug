<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Present as the SPA so the Sanctum session guard runs the same path as the
        // browser (see AuthControllerTest).
        $this->withHeader('Origin', 'http://localhost');
    }

    /**
     * A relative signed link for the given digest source, exactly as the notification
     * builds it: the signature covers the path + query only, never the origin, so the
     * SPA and API ports can differ (research D3).
     */
    private function verificationUrl(string $email, int $expireMinutes = 1440): string {
        return URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes($expireMinutes),
            ['hash' => sha1($email)],
            absolute: false,
        );
    }

    public function test_the_emailed_link_targets_the_spa_and_its_components_pass_the_api_check(): void {
        config(['app.frontend_url' => 'http://spa.test']);
        $user = User::factory()->unverified()->create();

        $link = (new VerifyEmail())->toMail($user)->actionUrl;

        // {FRONTEND_URL}/verify-email/{hash}?expires&signature — no ids of any
        // kind in the URL (owner requirement, research D3).
        $hash = sha1($user->email);
        $this->assertStringStartsWith("http://spa.test/verify-email/{$hash}?", $link);
        $query = (string) parse_url($link, PHP_URL_QUERY);
        $this->assertStringContainsString('expires=', $query);
        $this->assertStringContainsString('signature=', $query);
        // The SPA forwards the components verbatim; the relative signature must
        // hold on the API origin even though the email showed the SPA origin.
        $response = $this->actingAs($user)->getJson("/api/email/verify/{$hash}?{$query}");
        $response->assertOk();
        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    public function test_a_valid_link_marks_the_account_verified(): void {
        Event::fake([Verified::class]);
        $user = User::factory()->unverified()->create();

        $response = $this->actingAs($user)->getJson($this->verificationUrl($user->email));

        $response->assertOk();
        $response->assertJsonPath('meta.already_verified', false);
        $this->assertNotNull($response->json('data.email_verified_at'));
        $this->assertNotNull($user->fresh()->email_verified_at);
        Event::assertDispatched(Verified::class);
    }

    public function test_verifying_an_already_verified_account_is_an_idempotent_no_op(): void {
        Event::fake([Verified::class]);
        $user = User::factory()->create(['email_verified_at' => '2026-07-01 12:00:00']);

        $response = $this->actingAs($user)->getJson($this->verificationUrl($user->email));

        // FR-005: a second use is a friendly no-op, never an error.
        $response->assertOk();
        $response->assertJsonPath('meta.already_verified', true);
        $this->assertSame('2026-07-01 12:00:00', $user->fresh()->email_verified_at->format('Y-m-d H:i:s'));
        Event::assertNotDispatched(Verified::class);
    }

    public function test_an_expired_link_is_rejected_without_changing_state(): void {
        $user = User::factory()->unverified()->create();
        $url = $this->verificationUrl($user->email);

        // The link lives 24 h (FR-002); one hour past that it must be dead.
        $this->travel(25)->hours();
        $response = $this->actingAs($user)->getJson($url);

        $response->assertForbidden();
        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_a_tampered_signature_is_rejected_without_changing_state(): void {
        $user = User::factory()->unverified()->create();
        $url = (string) preg_replace(
            '/signature=\w+/',
            'signature=' . str_repeat('0', 64),
            $this->verificationUrl($user->email),
        );

        $response = $this->actingAs($user)->getJson($url);

        $response->assertForbidden();
        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_another_users_link_is_rejected_without_changing_state(): void {
        $user = User::factory()->unverified()->create();
        $other = User::factory()->unverified()->create();

        // Validly signed, but the digest belongs to a different account: the signed-in
        // user must not be able to verify with someone else's link (research D3).
        $response = $this->actingAs($user)->getJson($this->verificationUrl($other->email));

        $response->assertForbidden();
        $this->assertNull($user->fresh()->email_verified_at);
        $this->assertNull($other->fresh()->email_verified_at);
    }

    public function test_an_anonymous_request_is_rejected(): void {
        $user = User::factory()->unverified()->create();

        $response = $this->getJson($this->verificationUrl($user->email));

        $response->assertStatus(401);
        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_resend_dispatches_a_fresh_notification_to_an_unverified_user(): void {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $response = $this->actingAs($user)->postJson('/api/email/verification-notification');

        $response->assertOk();
        $response->assertExactJson(['message' => 'Verification link sent.']);
        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_resend_for_an_already_verified_user_is_refused_and_sends_nothing(): void {
        Notification::fake();
        $user = User::factory()->create(['email_verified_at' => '2026-07-01 12:00:00']);

        $response = $this->actingAs($user)->postJson('/api/email/verification-notification');

        // 409, not 200: there is nothing to send and the SPA tells the user so.
        $response->assertStatus(409);
        $response->assertExactJson(['message' => 'Email already verified.']);
        Notification::assertNothingSent();
    }

    public function test_resend_is_rejected_for_an_anonymous_request(): void {
        Notification::fake();

        $response = $this->postJson('/api/email/verification-notification');

        $response->assertStatus(401);
        Notification::assertNothingSent();
    }

    public function test_resend_is_rate_limited_after_six_requests_in_a_minute(): void {
        Notification::fake();
        $user = User::factory()->unverified()->create();
        for ($i = 0; $i < 6; $i++) {
            $this->actingAs($user)->postJson('/api/email/verification-notification');
        }

        $response = $this->actingAs($user)->postJson('/api/email/verification-notification');

        // FR-006: 6/min per user, same cap as the prototype's resend.
        $response->assertStatus(429);
    }

    public function test_verification_is_rate_limited_after_six_hits_in_a_minute(): void {
        $user = User::factory()->unverified()->create();
        $url = $this->verificationUrl($user->email);
        for ($i = 0; $i < 6; $i++) {
            $this->actingAs($user)->getJson($url);
        }

        $response = $this->actingAs($user)->getJson($url);

        $response->assertStatus(429);
    }
}
