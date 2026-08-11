<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use App\Models\UserIdentity;
use App\Services\PasswordService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Symfony\Component\HttpFoundation\Cookie as ResponseCookie;
use Tests\TestCase;

class PasswordResetControllerTest extends TestCase {
    use RefreshDatabase;

    /** The five account states FR-004 requires to be indistinguishable from one another. */
    private const ENUMERATION_STATES = ['enabled', 'unknown', 'disabled', 'throttled', 'mail-failure'];

    /** The single sentence every refusal on the check and reset routes answers with (FR-015, INV-7). */
    private const REFUSAL = 'This password recovery link is no longer valid.';

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

    /** Every way US4 names a link as dead (FR-015, SC-004). */
    private const DEAD_LINK_SCENARIOS = [
        'expired',
        'already-consumed',
        'superseded',
        'altered-token',
        'altered-digest',
        'missing-token',
        'unknown-digest',
        'deleted-account',
        'disabled-account',
        'voided-by-account-change',
    ];

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
     * FR-012 / contracts §2. The row is compared before and after, `created_at` included:
     * a check that refreshed the timestamp would silently extend every link's life, and a
     * check that consumed it would kill a link the moment a mail client previewed it.
     */
    public function test_the_check_confirms_a_live_link_and_leaves_the_row_untouched(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink();
        $before = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        $response = $this->postJson('/api/password/reset/check', ['hash' => sha1($user->email), 'token' => $token]);

        $response->assertNoContent();
        $this->assertEquals($before, DB::table('password_reset_tokens')->where('email', $user->email)->first());
    }

    public function test_the_check_refuses_a_tampered_token_with_the_one_refusal_message(): void {
        ['user' => $user] = $this->liveLink();

        $response = $this->postJson('/api/password/reset/check', [
            'hash' => sha1($user->email),
            'token' => str_repeat('a', 64),
        ]);

        $response->assertStatus(403);
        $response->assertExactJson(['message' => self::REFUSAL]);
    }

    public function test_the_check_requires_both_parts_of_the_link(): void {
        $response = $this->postJson('/api/password/reset/check', []);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['hash', 'token']);
    }

    /**
     * The whole of US2 in one test: the link is spent, the old password stops working, and
     * the new one starts. Both halves matter — asserting only that the new password signs in
     * would pass even if the row had grown a second credential rather than replaced one.
     */
    public function test_a_valid_link_replaces_the_password_and_the_old_one_stops_working(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink('OldPassw0rd');

        $response = $this->postJson('/api/password/reset', $this->resetPayload($user, $token));

        $response->assertOk();
        $response->assertExactJson(['message' => 'Your password has been changed. Please log in.']);
        $this->assertDatabaseCount('password_reset_tokens', 0);
        // 401 is login's generic credential refusal (007 D5) — the old password is now
        // simply a wrong password, indistinguishable from any other wrong one.
        $this->attemptLogin($user->email, 'OldPassw0rd')->assertStatus(401);
        $this->attemptLogin($user->email, 'NewPassw0rd')->assertOk();
    }

    /**
     * FR-021 / INV-6: possession of an inbox is not possession of a password. The response
     * says "please log in" and means it — no session is established, so the very next request
     * from this client is anonymous.
     */
    public function test_a_successful_reset_establishes_no_session(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink();

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/password/reset', $this->resetPayload($user, $token))
            ->assertOk();

        $this->assertGuest();
        $this->getJson('/api/user')->assertOk()->assertExactJson(['data' => null]);
    }

    /**
     * FR-011 / INV-7: the response is a message and nothing else. Not the address, not the
     * display name, not the account's public hash — nothing that would turn a stolen link
     * into a disclosure of whose link it was.
     */
    public function test_a_successful_reset_returns_no_account_detail(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink();

        $body = (string) $this->postJson('/api/password/reset', $this->resetPayload($user, $token))->getContent();

        foreach ([$user->email, $user->name, $user->hash, sha1($user->email)] as $detail) {
            $this->assertStringNotContainsString((string) $detail, $body);
        }
        $this->assertSame(['message'], array_keys((array) json_decode($body, true)));
    }

    /**
     * FR-019, second half. The account holder who loses access to their Google account keeps
     * their Ladybug one: recovery ADDS the password credential and removes nothing. The
     * identity row is compared whole, because "the Google link still works" is exactly the
     * claim a partial assertion would fail to make.
     */
    public function test_a_google_only_account_gains_a_password_without_losing_its_google_link(): void {
        $user = User::factory()->googleOnly()->create(['email' => 'grace@example.com']);
        UserIdentity::factory()->for($user)->create();
        $identityBefore = DB::table('user_identities')->where('user_id', $user->id)->first();
        $token = Password::broker()->createToken($user);

        $this->postJson('/api/password/reset', $this->resetPayload($user, $token))->assertOk();

        $this->assertEquals($identityBefore, DB::table('user_identities')->where('user_id', $user->id)->first());
        $this->attemptLogin($user->email, 'NewPassw0rd')->assertOk()->assertJsonPath('data.has_password', true);
    }

    /**
     * FR-033 names the reset form specifically, so the cap is asserted on all three endpoints
     * rather than on the request one alone — a bulk token-guessing run never touches /forgot.
     */
    public function test_the_check_endpoint_refuses_past_the_cap(): void {
        config(['app.auth_throttle' => 1]);
        ['user' => $user, 'token' => $token] = $this->liveLink();
        $payload = ['hash' => sha1($user->email), 'token' => $token];

        $this->postJson('/api/password/reset/check', $payload)->assertNoContent();

        $this->postJson('/api/password/reset/check', $payload)->assertStatus(429);
    }

    public function test_the_reset_endpoint_refuses_past_the_cap(): void {
        config(['app.auth_throttle' => 1]);
        ['user' => $user, 'token' => $token] = $this->liveLink();

        $this->postJson('/api/password/reset', $this->resetPayload($user, $token))->assertOk();

        $this->postJson('/api/password/reset', $this->resetPayload($user, $token))->assertStatus(429);
    }

    /**
     * The refusal matrix (FR-015, SC-004). Every way a link can be dead — expired, spent,
     * superseded, tampered, unknown, deleted, disabled — answers the SAME 403 on BOTH
     * endpoints, naming no account detail, and never changes a password.
     */
    public function test_every_dead_link_answers_the_one_refusal_on_both_endpoints_and_changes_nothing(): void {
        // Ten scenarios, two requests each: raised for the same reason T011 raises it — the
        // cap is a real, separate concern (FR-010) this test is not the one to exercise.
        config(['app.auth_throttle' => 1000]);

        foreach (self::DEAD_LINK_SCENARIOS as $scenario) {
            ['hash' => $hash, 'token' => $token, 'verify' => $verify] = $this->deadLink($scenario);

            $check = $this->postJson('/api/password/reset/check', ['hash' => $hash, 'token' => $token]);
            $check->assertStatus(403, "check should refuse the '{$scenario}' scenario");
            $check->assertExactJson(['message' => self::REFUSAL]);

            $reset = $this->postJson('/api/password/reset', [
                'hash' => $hash,
                'token' => $token,
                'password' => 'AttemptedPassw0rd',
                'password_confirmation' => 'AttemptedPassw0rd',
            ]);
            $reset->assertStatus(403, "reset should refuse the '{$scenario}' scenario");
            $reset->assertExactJson(['message' => self::REFUSAL]);

            $verify();
        }
    }

    /**
     * US2 scenarios 3-4: a rejected PASSWORD is not a rejected LINK. A 422 leaves the token
     * spendable, so a later, valid submission over the same link still succeeds.
     */
    public function test_a_policy_failure_leaves_the_link_alive_for_a_later_valid_attempt(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink();

        $this->postJson('/api/password/reset', [
            'hash' => sha1($user->email),
            'token' => $token,
            'password' => 'short',
            'password_confirmation' => 'short',
        ])->assertStatus(422);

        $this->postJson('/api/password/reset', $this->resetPayload($user, $token))->assertOk();
        $this->attemptLogin($user->email, 'NewPassw0rd')->assertOk();
    }

    /** FR-012: three checks in a row, and the row that answers them never moves. */
    public function test_checking_a_link_repeatedly_never_writes_to_it(): void {
        ['user' => $user, 'token' => $token] = $this->liveLink();
        $payload = ['hash' => sha1($user->email), 'token' => $token];

        $this->postJson('/api/password/reset/check', $payload)->assertNoContent();
        $this->postJson('/api/password/reset/check', $payload)->assertNoContent();
        $before = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        $this->postJson('/api/password/reset/check', $payload)->assertNoContent();

        $this->assertEquals($before, DB::table('password_reset_tokens')->where('email', $user->email)->first());
    }

    /**
     * Edge Cases / FR-016: the recovery route acts on the account the LINK names, never the
     * one the caller happens to be signed in as (research D11, which registers the route
     * unguarded for exactly this). A signed-in actor spending someone else's link ends that
     * someone's sessions, not their own; spending their OWN link ends their own session too,
     * because the recovery route keeps none (FR-021).
     */
    public function test_a_signed_in_actor_can_only_end_the_link_holders_sessions(): void {
        $holder = User::factory()->create(['email' => 'ada-holder@example.com', 'password' => 'HolderPassw0rd']);
        $actor = User::factory()->create(['email' => 'grace-actor@example.com', 'password' => 'ActorPassw0rd']);

        $holderCookie = $this->loginSession($holder->email, 'HolderPassw0rd');
        $actorCookie = $this->loginSession($actor->email, 'ActorPassw0rd');

        $holdersToken = Password::broker()->createToken($holder);
        $this->withSessionCookie($actorCookie)
            ->postJson('/api/password/reset', $this->resetPayload($holder, $holdersToken))
            ->assertOk();

        // The link changed the account it NAMES — the holder's, not the caller's.
        $this->assertTrue(Hash::check('NewPassw0rd', $holder->fresh()->password));

        // The holder's own client is signed out by a link it never asked anyone to use.
        // AuthenticateSession catches the stale `password_hash_web` and throws rather than
        // degrading to anonymous, so the next request is a hard 401, not a quiet `data: null`.
        $this->withSessionCookie($holderCookie)->getJson('/api/user')->assertStatus(401);
        // The actor who performed the reset keeps their own, unrelated session.
        $this->withSessionCookie($actorCookie)->getJson('/api/user')
            ->assertOk()->assertJsonPath('data.email', 'grace-actor@example.com');

        // Spending one's OWN link ends the acting session too — the recovery route keeps none.
        $ownToken = Password::broker()->createToken($actor);
        $this->withSessionCookie($actorCookie)
            ->postJson('/api/password/reset', $this->resetPayload($actor, $ownToken, 'ActorsNewPassw0rd'))
            ->assertOk();

        $this->withSessionCookie($actorCookie)->getJson('/api/user')->assertStatus(401);
    }

    /**
     * An enabled account with one live link, plus the plaintext token only the email would
     * carry.
     *
     * @return array{user: User, token: string}
     */
    private function liveLink(string $password = 'OldPassw0rd'): array {
        $user = User::factory()->create(['email' => 'ada@example.com', 'password' => $password]);

        return ['user' => $user, 'token' => Password::broker()->createToken($user)];
    }

    /** @return array<string, string> */
    private function resetPayload(User $user, string $token, string $password = 'NewPassw0rd'): array {
        return [
            'hash' => sha1($user->email),
            'token' => $token,
            'password' => $password,
            'password_confirmation' => $password,
        ];
    }

    /** Sanctum's SPA session only starts for a same-origin request, so the header is required. */
    private function attemptLogin(string $email, string $password): TestResponse {
        return $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => $email, 'password' => $password]);
    }

    /**
     * Sign in for real and hand back the session cookie a browser would keep afterward.
     * Flushing the queued jar between successive logins in the same test keeps one client's
     * cookie from leaking into the next capture (mirrors AuthControllerTest's FR-007 test).
     */
    private function loginSession(string $email, string $password): ResponseCookie {
        $this->app['auth']->forgetGuards();
        $response = $this->attemptLogin($email, $password);
        $response->assertOk();
        $cookie = $response->getCookie((string) config('session.cookie'), false);
        Cookie::flushQueuedCookies();

        return $cookie;
    }

    /**
     * Replay a captured session cookie on the next request, the way a real browser would.
     * `forgetGuards()` is required here for the same reason AuthControllerTest's
     * `actAsFreshClient` needs it: the guard singleton caches whichever user its LAST
     * resolution found, and a single test process shares that singleton across every request
     * it makes — a real browser never does, because every request there boots a fresh one.
     */
    private function withSessionCookie(ResponseCookie $cookie): self {
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withUnencryptedCookie($cookie->getName(), $cookie->getValue());
    }

    /**
     * One dead link, built the way US4's scenario names it.
     *
     * @return array{hash: string, token: string, verify: callable(): void}
     */
    private function deadLink(string $scenario): array {
        return match ($scenario) {
            'expired' => $this->expiredLink(),
            'already-consumed' => $this->consumedLink(),
            'superseded' => $this->supersededLink(),
            'altered-token' => $this->alteredTokenLink(),
            'altered-digest' => $this->alteredDigestLink(),
            'missing-token' => $this->missingTokenLink(),
            'unknown-digest' => $this->unknownDigestLink(),
            'deleted-account' => $this->deletedAccountLink(),
            'disabled-account' => $this->disabledAccountLink(),
            'voided-by-account-change' => $this->voidedByAccountChangeLink(),
        };
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function expiredLink(): array {
        $user = User::factory()->create(['email' => 'ada-expired@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);
        $expire = (int) config('auth.passwords.users.expire');
        DB::table('password_reset_tokens')->where('email', $user->email)
            ->update(['created_at' => now()->subMinutes($expire + 1)]);

        return $this->scenario($user, $token, 'OldPassw0rd');
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function consumedLink(): array {
        $user = User::factory()->create(['email' => 'ada-consumed@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);
        app(PasswordService::class)->reset(sha1($user->email), $token, 'FirstNewPassw0rd');

        return $this->scenario($user, $token, 'FirstNewPassw0rd');
    }

    /** A second request replaces the first row entirely, leaving the stale token dangling. */
    private function supersededLink(): array {
        $user = User::factory()->create(['email' => 'ada-superseded@example.com', 'password' => 'OldPassw0rd']);
        $staleToken = Password::broker()->createToken($user);
        Password::broker()->createToken($user);

        return $this->scenario($user, $staleToken, 'OldPassw0rd');
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function alteredTokenLink(): array {
        $user = User::factory()->create(['email' => 'ada-altered-token@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);

        return $this->scenario($user, strrev($token), 'OldPassw0rd');
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function alteredDigestLink(): array {
        $user = User::factory()->create(['email' => 'ada-altered-digest@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);

        return ['hash' => strrev(sha1($user->email)), 'token' => $token, 'verify' => fn () => $this->assertUnchanged($user, 'OldPassw0rd')];
    }

    /** A real account with no outstanding request at all — the token is guessed, not tampered. */
    private function missingTokenLink(): array {
        $user = User::factory()->create(['email' => 'ada-missing-token@example.com', 'password' => 'OldPassw0rd']);

        return ['hash' => sha1($user->email), 'token' => str_repeat('c', 64), 'verify' => fn () => $this->assertUnchanged($user, 'OldPassw0rd')];
    }

    /** No account owns this digest at all — there is nothing to verify afterward. */
    private function unknownDigestLink(): array {
        return [
            'hash' => sha1('nobody-at-all@example.com'),
            'token' => str_repeat('d', 64),
            'verify' => static function (): void {
            },
        ];
    }

    private function deletedAccountLink(): array {
        $user = User::factory()->create(['email' => 'ada-deleted@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);
        $hash = sha1($user->email);
        $user->delete();

        return [
            'hash' => $hash,
            'token' => $token,
            'verify' => fn () => $this->assertDatabaseMissing('users', ['email' => 'ada-deleted@example.com']),
        ];
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function disabledAccountLink(): array {
        $user = User::factory()->disabled()->create(['email' => 'ada-disabled@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);

        return $this->scenario($user, $token, 'OldPassw0rd');
    }

    /** An account-page change (FR-008) revokes any outstanding recovery link on the spot. */
    private function voidedByAccountChangeLink(): array {
        $user = User::factory()->create(['email' => 'ada-voided@example.com', 'password' => 'OldPassw0rd']);
        $token = Password::broker()->createToken($user);
        app(PasswordService::class)->change($user, 'ChangedPassw0rd');

        return $this->scenario($user, $token, 'ChangedPassw0rd');
    }

    /** @return array{hash: string, token: string, verify: callable(): void} */
    private function scenario(User $user, string $token, string $expectedPassword): array {
        return [
            'hash' => sha1($user->email),
            'token' => $token,
            'verify' => fn () => $this->assertUnchanged($user, $expectedPassword),
        ];
    }

    private function assertUnchanged(User $user, string $expectedPassword): void {
        $this->assertTrue(Hash::check($expectedPassword, $user->fresh()->password));
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
