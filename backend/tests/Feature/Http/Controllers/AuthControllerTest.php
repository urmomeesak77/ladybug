<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use App\Models\UserIdentity;
use App\Services\UserAdminService;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

class AuthControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Auth endpoints use the Sanctum SPA session guard, which only starts a session
        // for requests from a stateful frontend domain. Present as the SPA so login/
        // session handling runs the same path as the browser ('localhost' is stateful).
        $this->withHeader('Origin', 'http://localhost');
    }

    private function registration(array $overrides = []): array {
        return array_merge([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'Password1',
            'password_confirmation' => 'Password1',
        ], $overrides);
    }

    public function test_register_creates_a_user_and_returns_the_safe_profile(): void {
        $response = $this->postJson('/api/register', $this->registration());

        $response->assertCreated();
        $response->assertJsonStructure(['data' => ['hash', 'name', 'email', 'created_at', 'updated_at']]);
        $response->assertJsonPath('data.email', 'ada@example.com');
        $this->assertArrayNotHasKey('password', $response->json('data'));
        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
    }

    public function test_register_reports_the_new_account_as_a_member(): void {
        // Every new account defaults to the member role, and the payload exposes it so
        // the SPA knows the viewer's role from the register response alone (FR-004/FR-007).
        $response = $this->postJson('/api/register', $this->registration());

        $response->assertCreated();
        $response->assertJsonPath('data.role', 'member');
    }

    public function test_register_reports_the_fresh_account_as_unverified(): void {
        $response = $this->postJson('/api/register', $this->registration());

        $response->assertCreated();
        // The key must be present even while null — the SPA reads it to decide
        // whether to steer the user toward the verification notice (008).
        $this->assertArrayHasKey('email_verified_at', $response->json('data'));
        $this->assertNull($response->json('data.email_verified_at'));
    }

    public function test_register_sends_the_verification_notification_to_the_new_user(): void {
        Notification::fake();

        $response = $this->postJson('/api/register', $this->registration());

        $response->assertCreated();
        $user = User::where('email', 'ada@example.com')->firstOrFail();
        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_register_still_succeeds_when_the_verification_email_cannot_be_sent(): void {
        // FR-011: a mail-transport failure must be reported, not surfaced — the
        // account exists and the resend endpoint is the recovery path.
        Exceptions::fake();
        $this->mock(NotificationDispatcher::class, static function ($mock): void {
            $mock->shouldReceive('send')->andThrow(new RuntimeException('mail transport down'));
        });

        $response = $this->postJson('/api/register', $this->registration());

        $response->assertCreated();
        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
        Exceptions::assertReported(RuntimeException::class);
    }

    public function test_register_logs_the_new_user_in(): void {
        $this->postJson('/api/register', $this->registration());

        $this->assertAuthenticated();
    }

    public function test_register_rejects_a_duplicate_email(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/register', $this->registration());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('email');
        $this->assertSame(1, User::where('email', 'ada@example.com')->count());
    }

    public function test_register_rejects_a_password_that_fails_the_strength_policy(): void {
        $response = $this->postJson('/api/register', $this->registration([
            'password' => 'weak',
            'password_confirmation' => 'weak',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertDatabaseMissing('users', ['email' => 'ada@example.com']);
    }

    public function test_register_rejects_a_mismatched_confirmation(): void {
        $response = $this->postJson('/api/register', $this->registration([
            'password_confirmation' => 'Different1',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
    }

    public function test_login_with_correct_credentials_returns_the_user_and_authenticates(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);

        $response->assertOk();
        $response->assertJsonPath('data.email', 'ada@example.com');
        $this->assertArrayNotHasKey('password', $response->json('data'));
        $this->assertAuthenticated();
    }

    public function test_login_carries_the_verification_timestamp_for_a_verified_user(): void {
        User::factory()->create([
            'email' => 'ada@example.com',
            'email_verified_at' => '2026-07-01 12:00:00',
        ]);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);

        $response->assertOk();
        $this->assertMatchesRegularExpression(
            '/^2026-07-01T12:00:00/',
            (string) $response->json('data.email_verified_at'),
        );
    }

    public function test_login_with_remember_true_succeeds(): void {
        // Regression guard: Auth::attempt() must only ever see email/password. Feeding it
        // the whole validated() payload (which now also carries `remember`) throws against
        // real MySQL, since EloquentUserProvider turns every non-password key into a
        // `->where()` clause and `remember` is not a users column (sqlite masks this).
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ]);

        $response->assertOk();
        $this->assertAuthenticated();
    }

    public function test_login_with_remember_true_sets_the_remember_cookie_and_a_seven_day_session_lifetime(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ]);

        $response->assertOk();
        $response->assertCookie((string) config('remember.cookie'), '1');

        $sessionCookie = $response->getCookie((string) config('session.cookie'), false);
        $this->assertNotNull($sessionCookie);
        $this->assertEqualsWithDelta(
            now()->addMinutes((int) config('remember.lifetime'))->getTimestamp(),
            $sessionCookie->getExpiresTime(),
            5,
        );
    }

    public function test_login_with_remember_false_succeeds(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => false,
        ]);

        $response->assertOk();
        $this->assertAuthenticated();
        $response->assertCookieMissing((string) config('remember.cookie'));
        $this->assertDefaultSessionLifetime($response);
    }

    public function test_login_with_remember_omitted_sets_no_remember_cookie(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);

        $response->assertOk();
        $response->assertCookieMissing((string) config('remember.cookie'));
        $this->assertDefaultSessionLifetime($response);
    }

    /**
     * SC-003: a non-remembered login carries the untouched default SESSION_LIFETIME (120
     * minutes), never the 7-day `remember.lifetime` — the byte-for-byte baseline US3 exists
     * to protect.
     */
    private function assertDefaultSessionLifetime(TestResponse $response): void {
        $sessionCookie = $response->getCookie((string) config('session.cookie'), false);
        $this->assertNotNull($sessionCookie);
        $this->assertEqualsWithDelta(
            now()->addMinutes((int) config('session.lifetime'))->getTimestamp(),
            $sessionCookie->getExpiresTime(),
            5,
        );
    }

    public function test_login_on_a_disabled_account_with_remember_true_still_refuses_and_queues_no_cookie(): void {
        // Contract §"403": the disabled check runs before the remember-handling (D4), so a
        // disabled account can never end up with a lingering remember cookie from a login
        // attempt, even when the attempt asked to be remembered.
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create(['email' => 'ada@example.com']);
        app(UserAdminService::class)->disable($actor, $target->hash);

        $response = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ]);

        $response->assertStatus(403);
        $response->assertCookieMissing((string) config('remember.cookie'));
        $this->assertGuest();
    }

    public function test_logout_after_a_remembered_login_clears_the_remember_cookie(): void {
        // FR-005/SC-004: manual sign-out ends the session immediately — the 7-day allowance
        // never overrides an explicit sign-out.
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ])->assertCookie((string) config('remember.cookie'), '1');

        $response = $this->actingAs($user)->postJson('/api/logout');

        $response->assertOk();
        $response->assertCookieExpired((string) config('remember.cookie'));
    }

    public function test_logout_clears_the_remember_cookie_when_the_request_actually_carries_it(): void {
        // Regression: the test above uses actingAs(), which authenticates the request
        // without ever attaching a real incoming remember cookie — so it never exercises
        // SlideRememberMeCookie's after-phase. A genuine browser round trip DOES carry the
        // cookie on /api/logout, and that route sits behind auth:sanctum, which switches
        // the request's default guard to 'sanctum' (Authenticate::shouldUse) before the
        // controller runs. AuthController::logout() only logs out the 'web' guard, so a
        // same-request check via the (now-default) 'sanctum' guard still sees an
        // authenticated user and would undo RememberMe::forget() (FR-005/SC-004).
        User::factory()->create(['email' => 'ada@example.com']);

        $login = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ]);
        $login->assertCookie((string) config('remember.cookie'), '1');

        $sessionCookie = $login->getCookie((string) config('session.cookie'), false);
        $rememberCookie = $login->getCookie((string) config('remember.cookie'), false);

        // postJson() never attaches cookies unless withCredentials() is enabled (it defaults
        // to false) — without it, this "second request" would silently carry no cookies at
        // all and prove nothing, same blind spot that hid this bug from every other test here.
        $response = $this
            ->withCredentials()
            ->withUnencryptedCookie($sessionCookie->getName(), $sessionCookie->getValue())
            ->withUnencryptedCookie($rememberCookie->getName(), $rememberCookie->getValue())
            ->postJson('/api/logout');

        $response->assertOk();
        $response->assertCookieExpired((string) config('remember.cookie'));
    }

    public function test_a_remember_cookie_from_one_login_does_not_leak_into_a_separate_logins_response(): void {
        // FR-007: the "Remember me" choice applies only to the session it was made for. In
        // production each request boots a fresh application container (research D3), so
        // Laravel's queued-cookie jar never carries state between two real requests; here we
        // flush it the same way a fresh container would, then prove OUR code — not a leftover
        // queue — decides whether the second, unrelated login gets the cookie.
        User::factory()->create(['email' => 'ada@example.com']);
        User::factory()->create(['email' => 'grace@example.com']);

        $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
            'remember' => true,
        ])->assertCookie((string) config('remember.cookie'), '1');
        Cookie::flushQueuedCookies();

        $response = $this->postJson('/api/login', [
            'email' => 'grace@example.com',
            'password' => 'password',
            'remember' => false,
        ]);

        $response->assertOk();
        $response->assertCookieMissing((string) config('remember.cookie'));
    }

    public function test_login_with_a_wrong_password_is_rejected_without_disclosure(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'These credentials do not match our records.']);
        $this->assertGuest();
    }

    public function test_login_with_an_unknown_email_gives_the_same_generic_error(): void {
        $response = $this->postJson('/api/login', ['email' => 'nobody@example.com', 'password' => 'password']);

        $response->assertStatus(401);
        // Identical message to the wrong-password case — no account enumeration (D5).
        $response->assertExactJson(['message' => 'These credentials do not match our records.']);
    }

    public function test_login_on_a_disabled_account_is_refused_with_403_and_no_session(): void {
        // FR-013, research D4: credentials verify FIRST, then the disabled state is disclosed
        // with a distinct 403 — so only the true owner ever learns the account is disabled,
        // and the login form is not an account-state oracle. No session is left behind.
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create(['email' => 'ada@example.com']);
        app(UserAdminService::class)->disable($actor, $target->hash);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);

        $response->assertStatus(403);
        $response->assertExactJson(['message' => 'This account is disabled.']);
        $this->assertGuest();
    }

    public function test_login_on_a_disabled_account_with_wrong_credentials_still_gives_the_generic_401(): void {
        // The disabled check runs only after credentials verify, so a wrong password on a
        // disabled account is indistinguishable from any other bad-credential attempt (D4).
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create(['email' => 'ada@example.com']);
        app(UserAdminService::class)->disable($actor, $target->hash);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'These credentials do not match our records.']);
        $this->assertGuest();
    }

    public function test_a_re_enabled_account_signs_in_with_its_original_password(): void {
        // FR-015/SC-006: re-enabling restores sign-in with the EXISTING credentials — no
        // re-registration, no re-verification. Disabling never mutated the password.
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create(['email' => 'ada@example.com']);
        $service = app(UserAdminService::class);
        $service->disable($actor, $target->hash);
        $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password'])->assertStatus(403);

        $service->enable($actor, $target->hash);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);
        $response->assertOk();
        $this->assertAuthenticated();
    }

    public function test_registration_with_a_disabled_accounts_email_is_refused_and_does_not_reactivate(): void {
        // Contract §4.3: no recovery path clears disabled_at. The unique-email rule refuses the
        // address whatever the account's state, so there is no new row and disabled_at is untouched.
        $actor = User::factory()->admin()->create();
        $disabled = User::factory()->create(['email' => 'ada@example.com']);
        app(UserAdminService::class)->disable($actor, $disabled->hash);

        $response = $this->postJson('/api/register', $this->registration(['email' => 'ada@example.com']));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('email');
        $this->assertNotNull($disabled->fresh()->disabled_at);
    }

    public function test_login_on_a_passwordless_account_is_refused_with_the_generic_401(): void {
        // contracts/password-login-invariant.md §1: users.password lost NOT NULL in 017,
        // so "every account has a password" is now behaviour rather than structure.
        // Hash::check() fails closed on a null stored hash, so Auth::attempt() cannot
        // succeed — asserted here rather than assumed, because a framework upgrade that
        // changed it must fail loudly (research D6).
        User::factory()->googleOnly()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'anything']);

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'These credentials do not match our records.']);
        $this->assertGuest();
    }

    public function test_the_passwordless_401_is_byte_identical_to_a_wrong_password_401(): void {
        // SC-008: the login form must not become an oracle for which accounts are
        // Google-only. Both paths run the same Auth::attempt() call, so there is no
        // timing branch either.
        User::factory()->googleOnly()->create(['email' => 'google-only@example.com']);
        User::factory()->create(['email' => 'has-password@example.com']);

        $passwordless = $this->postJson('/api/login', ['email' => 'google-only@example.com', 'password' => 'anything']);
        $wrongPassword = $this->postJson('/api/login', ['email' => 'has-password@example.com', 'password' => 'anything']);

        $this->assertSame($wrongPassword->getStatusCode(), $passwordless->getStatusCode());
        $this->assertSame($wrongPassword->getContent(), $passwordless->getContent());
        $this->assertSame(
            array_keys($wrongPassword->headers->all()),
            array_keys($passwordless->headers->all()),
        );
        $this->assertSame(
            $wrongPassword->headers->get('Content-Type'),
            $passwordless->headers->get('Content-Type'),
        );
    }

    public function test_login_on_a_passwordless_account_never_reaches_the_disabled_403(): void {
        // §2: the disabled 403 still runs only AFTER credentials verify, and a
        // passwordless account's credentials never verify — so it cannot be told apart
        // from any other bad-credential attempt.
        $actor = User::factory()->admin()->create();
        $target = User::factory()->googleOnly()->create(['email' => 'ada@example.com']);
        app(UserAdminService::class)->disable($actor, $target->hash);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'anything']);

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'These credentials do not match our records.']);
    }

    public function test_login_on_a_passwordless_account_refuses_an_empty_password_at_validation(): void {
        // Guard 1 of FR-020: LoginRequest still requires the field, so an empty password
        // is a 422 and never reaches Auth::attempt() at all.
        User::factory()->googleOnly()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => '']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertGuest();
    }

    public function test_login_on_a_passwordless_account_refuses_an_absent_password(): void {
        User::factory()->googleOnly()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertGuest();
    }

    public function test_login_on_a_passwordless_account_refuses_a_null_password(): void {
        // An explicit null is the same as absent to the `required` rule — asserted so
        // the three shapes in §1's table are all covered, not just the two obvious ones.
        User::factory()->googleOnly()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => null]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertGuest();
    }

    public function test_login_rejects_a_malformed_request(): void {
        $response = $this->postJson('/api/login', ['email' => 'not-an-email', 'password' => '']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_login_is_rate_limited_after_too_many_attempts(): void {
        User::factory()->create(['email' => 'ada@example.com']);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);
        }

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);

        // The default throttle:api (60/min) is too permissive for credential guessing;
        // login must lock an origin out after a handful of attempts.
        $response->assertStatus(429);
    }

    public function test_auth_throttle_limit_is_env_configurable(): void {
        // The e2e stack registers several real users per run, so the limit must be
        // tunable per environment; the production default stays at 5/min.
        config(['app.auth_throttle' => 2]);
        for ($i = 0; $i < 2; $i++) {
            $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);
        }

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'wrong-password']);

        $response->assertStatus(429);
    }

    public function test_register_is_rate_limited_after_too_many_attempts(): void {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/register', []);
        }

        $response = $this->postJson('/api/register', []);

        $response->assertStatus(429);
    }

    public function test_logout_succeeds_for_an_authenticated_user(): void {
        // The actual session revocation (Auth::logout + session invalidate) is a
        // framework behavior best proven against real database sessions in the live SPA
        // smoke; the array-driver test guard caches the user across requests, so
        // cross-request revocation is not observable here. We assert the contract that
        // logout authorizes + responds for an authenticated user, and (below) that it is
        // refused when anonymous.
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/logout');

        $response->assertOk();
        $response->assertExactJson(['message' => 'Logged out.']);
    }

    public function test_logout_is_rejected_for_an_anonymous_request(): void {
        $response = $this->postJson('/api/logout');

        $response->assertStatus(401);
    }

    public function test_user_returns_the_authenticated_users_safe_profile(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->actingAs($user)->getJson('/api/user');

        $response->assertOk();
        $response->assertJsonPath('data.email', 'ada@example.com');
        $this->assertArrayNotHasKey('password', $response->json('data'));
    }

    public function test_user_payload_includes_the_accounts_role(): void {
        // The current-user probe carries the stored role so the SPA can derive the
        // viewer's effective role from the session it rehydrates (FR-006/FR-007).
        $user = User::factory()->admin()->create();

        $response = $this->actingAs($user)->getJson('/api/user');

        $response->assertOk();
        $response->assertJsonPath('data.role', 'admin');
    }

    public function test_user_reports_an_unverified_email_as_null(): void {
        $user = User::factory()->unverified()->create();

        $response = $this->actingAs($user)->getJson('/api/user');

        $response->assertOk();
        $this->assertArrayHasKey('email_verified_at', $response->json('data'));
        $this->assertNull($response->json('data.email_verified_at'));
    }

    public function test_it_renames_the_signed_in_account(): void {
        $user = User::factory()->create(['name' => 'Ada']);

        $response = $this->actingAs($user)->patchJson('/api/user', ['name' => 'Grace']);

        $response->assertOk();
        $response->assertJsonPath('data.name', 'Grace');
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Grace']);
    }

    public function test_it_refuses_a_name_another_account_already_holds(): void {
        User::factory()->create(['name' => 'Grace', 'email' => 'grace@example.com']);
        $user = User::factory()->create(['name' => 'Ada']);

        $response = $this->actingAs($user)->patchJson('/api/user', ['name' => 'Grace']);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.name.0', 'That name is already taken.');
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Ada']);
    }

    public function test_it_accepts_the_accounts_own_current_name_unchanged(): void {
        // The uniqueness check ignores the requester's own row, so re-saving the same
        // name is a no-op success rather than a collision with itself.
        $user = User::factory()->create(['name' => 'Ada']);

        $this->actingAs($user)->patchJson('/api/user', ['name' => 'Ada'])->assertOk();
    }

    public function test_it_requires_a_name_to_rename(): void {
        $user = User::factory()->create(['name' => 'Ada']);

        $response = $this->actingAs($user)->patchJson('/api/user', ['name' => '']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('name');
    }

    public function test_it_ignores_other_fields_submitted_with_the_rename(): void {
        // Only the name is editable here: role, email and verification state are not
        // reachable through this endpoint (Principle VI).
        $user = User::factory()->create(['name' => 'Ada', 'email' => 'ada@example.com']);

        $this->actingAs($user)->patchJson('/api/user', [
            'name' => 'Grace',
            'email' => 'root@example.com',
            'role' => 'superuser',
        ])->assertOk();

        $user->refresh();
        $this->assertSame('ada@example.com', $user->email);
        $this->assertSame('member', $user->role->value);
    }

    public function test_rename_is_rejected_for_an_anonymous_request(): void {
        $this->patchJson('/api/user', ['name' => 'Grace'])->assertStatus(401);
    }

    /**
     * The deliberate half of password management (022, US3): no inbox, no link, no
     * waiting — the live session is the proof of identity, and the current password is
     * the proof it is still the owner holding it.
     */
    public function test_it_changes_the_signed_in_accounts_password(): void {
        $user = User::factory()->create(['password' => 'OldPassw0rd']);

        $response = $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.has_password', true);
        $this->assertTrue(Hash::check('NewPassw0rd', $user->fresh()->password));
    }

    public function test_the_changed_password_replaces_the_old_one_at_the_sign_in_form(): void {
        $user = User::factory()->create(['email' => 'ada@example.com', 'password' => 'OldPassw0rd']);

        $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ])->assertOk();

        $this->useWebGuard();
        $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'OldPassw0rd'])->assertStatus(401);
        $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'NewPassw0rd'])->assertOk();
    }

    public function test_it_refuses_a_wrong_current_password_and_echoes_no_password_back(): void {
        // US3 scenario 3: the refusal names the field, and the response carries neither
        // the value the owner typed nor the one they tried to replace it with — a 422 body
        // is logged and rendered in places a password has no business reaching.
        $user = User::factory()->create(['password' => 'OldPassw0rd']);

        $response = $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'GuessedPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('current_password');
        $response->assertDontSee('NewPassw0rd');
        $response->assertDontSee('GuessedPassw0rd');
        $this->assertTrue(Hash::check('OldPassw0rd', $user->fresh()->password));
    }

    public function test_it_refuses_a_new_password_that_fails_the_shared_policy(): void {
        $user = User::factory()->create(['password' => 'OldPassw0rd']);

        $response = $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'short',
            'password_confirmation' => 'short',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertTrue(Hash::check('OldPassw0rd', $user->fresh()->password));
    }

    public function test_it_refuses_a_mismatched_confirmation(): void {
        $user = User::factory()->create(['password' => 'OldPassw0rd']);

        $response = $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'Other1234',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('password');
        $this->assertTrue(Hash::check('OldPassw0rd', $user->fresh()->password));
    }

    public function test_password_change_is_rejected_for_an_anonymous_request(): void {
        $this->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ])->assertStatus(401);
    }

    /**
     * FR-030. The cap belongs to the ACCOUNT here, not to the address the request came
     * from: a borrowed session must not become an offline-speed oracle for the password
     * it did not come with.
     */
    public function test_password_change_is_rate_limited_per_account(): void {
        config(['app.auth_throttle' => 2]);
        $user = User::factory()->create(['password' => 'OldPassw0rd']);

        for ($i = 0; $i < 2; $i++) {
            $this->actingAs($user)->putJson('/api/user/password', $this->guess())->assertStatus(422);
        }

        $this->actingAs($user)->putJson('/api/user/password', $this->guess())->assertStatus(429);
    }

    public function test_one_accounts_spent_allowance_does_not_block_another_account(): void {
        // The proof that the bucket is keyed by account: two owners on one office IP do
        // not spend each other's attempts.
        config(['app.auth_throttle' => 2]);
        $ada = User::factory()->create(['password' => 'OldPassw0rd']);
        $grace = User::factory()->create(['password' => 'OldPassw0rd']);

        for ($i = 0; $i < 3; $i++) {
            $this->actAsFreshClient($ada)->putJson('/api/user/password', $this->guess());
        }

        $this->actAsFreshClient($grace)->putJson('/api/user/password', $this->guess())->assertStatus(422);
    }

    /**
     * The two tests above key the bucket through `actingAs`, which installs the user resolver
     * directly — so they would pass even if the REAL cookie-session path resolved no user
     * inside the limiter and silently fell back to keying by IP. That is not a hypothetical
     * failure mode here: `auth:sanctum` switches the default guard mid-request, and this
     * project has already been bitten by after-phase middleware reading the ambient guard.
     *
     * This drives the limiter over a real signed-in cookie instead. Two accounts share one
     * IP; the first spends its whole allowance, and the second must still be served. Under
     * IP keying the second would get a 429.
     */
    public function test_the_per_account_bucket_holds_over_a_real_session_cookie(): void {
        config(['app.auth_throttle' => 2]);
        User::factory()->create(['email' => 'ada@example.com', 'password' => 'OldPassw0rd']);
        User::factory()->create(['email' => 'grace@example.com', 'password' => 'OldPassw0rd']);

        $ada = $this->loginSession('ada@example.com', 'OldPassw0rd');
        for ($i = 0; $i < 3; $i++) {
            $this->withSessionCookie($ada['cookie'])->putJson('/api/user/password', $this->guess());
        }

        $grace = $this->loginSession('grace@example.com', 'OldPassw0rd');
        $this->withSessionCookie($grace['cookie'])
            ->putJson('/api/user/password', $this->guess())
            ->assertStatus(422);
    }

    /**
     * FR-019 / FR-031: an account created through Google has `password IS NULL`, so there
     * is no current password to prove — the live session is the proof. The field is absent
     * from the rule set entirely, not present-and-optional.
     */
    public function test_a_google_only_account_sets_a_first_password_without_a_current_one(): void {
        $user = User::factory()->googleOnly()->create();

        $response = $this->actingAs($user)->putJson('/api/user/password', [
            'password' => 'FirstPassw0rd',
            'password_confirmation' => 'FirstPassw0rd',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.has_password', true);
        $this->assertTrue(Hash::check('FirstPassw0rd', $user->fresh()->password));
    }

    public function test_setting_a_first_password_leaves_the_google_link_untouched(): void {
        // The account gains a second door; it does not lose the one it came in through.
        $user = User::factory()->googleOnly()->create();
        $identity = UserIdentity::factory()->create(['user_id' => $user->id]);
        $before = DB::table('user_identities')->where('id', $identity->id)->first();

        $this->actingAs($user)->putJson('/api/user/password', [
            'password' => 'FirstPassw0rd',
            'password_confirmation' => 'FirstPassw0rd',
        ])->assertOk();

        $this->assertEquals($before, DB::table('user_identities')->where('id', $identity->id)->first());
    }

    public function test_a_google_only_account_ignores_a_submitted_current_password(): void {
        // The rule is absent, so a value sent for it is ignored rather than checked —
        // there is nothing to guess at (FR-031).
        $user = User::factory()->googleOnly()->create();

        $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'anything-at-all',
            'password' => 'FirstPassw0rd',
            'password_confirmation' => 'FirstPassw0rd',
        ])->assertOk();
    }

    /**
     * FR-028: unlike the recovery route (which keeps none), the account-page change keeps
     * the ACTING session alive — it names itself via session()->getId() so the owner who
     * just typed their own current password is not immediately signed out by the change
     * they made. Every other row for the account is gone (FR-016).
     */
    public function test_a_password_change_keeps_the_acting_session_and_ends_every_other_one(): void {
        $user = User::factory()->create(['email' => 'ada@example.com', 'password' => 'OldPassw0rd']);
        $acting = $this->loginSession($user->email, 'OldPassw0rd');
        $other = $this->loginSession($user->email, 'OldPassw0rd');

        $this->withSessionCookie($acting['cookie'])->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ])->assertOk();

        $this->assertDatabaseHas('sessions', ['id' => $acting['id']]);
        $this->withSessionCookie($acting['cookie'])->getJson('/api/user')
            ->assertOk()->assertJsonPath('data.email', 'ada@example.com');

        // Checked at the DB layer, not through a further simulated request on $other's
        // cookie: this single PHP process shares ONE Session Store singleton across every
        // request it makes (unlike production, where every request boots its own), and
        // Store::loadSession()'s array_replace() silently keeps stale attributes on an empty
        // read — the same masking RememberMeSessionExpiryTest's docblock names.
        $this->assertDatabaseMissing('sessions', ['id' => $other['id']]);
    }

    /**
     * FR-016: 018's "remember me" is a lifetime extension on the SAME session row, not a
     * separate token (research D6) — so a password change must end a remembered session
     * exactly as it ends any other one, and the leftover flag cookie grants nothing on its
     * own once the row is gone.
     */
    public function test_a_password_change_ends_a_previously_remembered_session(): void {
        $user = User::factory()->create(['email' => 'ada@example.com', 'password' => 'OldPassw0rd']);
        $this->app['auth']->forgetGuards();
        $remembered = $this->withHeader('Origin', 'http://localhost')->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'OldPassw0rd',
            'remember' => true,
        ]);
        $remembered->assertOk();
        $rememberedId = (string) $remembered->getCookie((string) config('session.cookie'), true)->getValue();
        Cookie::flushQueuedCookies();
        $acting = $this->loginSession($user->email, 'OldPassw0rd');

        $this->withSessionCookie($acting['cookie'])->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ])->assertOk();

        // See the sibling test above for why this stays at the DB layer.
        $this->assertDatabaseMissing('sessions', ['id' => $rememberedId]);
    }

    /**
     * SC-007/FR-017/FR-020, the same schema-driven snapshot T063 asserts for the recovery
     * route — read from the live schema so a future column this feature is not supposed to
     * touch (FR-034) fails this test rather than passing it unnoticed (INV-5).
     */
    public function test_a_password_change_leaves_every_other_user_column_byte_identical(): void {
        $user = User::factory()->create(['password' => 'OldPassw0rd']);
        $before = $this->userSnapshot($user);

        $this->actingAs($user)->putJson('/api/user/password', [
            'current_password' => 'OldPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ])->assertOk();

        $this->assertSame($before, $this->userSnapshot($user->fresh()));
    }

    /**
     * Sign in for real and hand back both the session cookie a browser would keep afterward
     * AND the plain `sessions.id` it carries — the cookie's own value is encrypted (Laravel's
     * EncryptCookies), so a DB assertion needs the decrypted form while a cookie replay needs
     * the encrypted one. Mirrors PasswordResetControllerTest's helper of the same name —
     * flushing the queued jar between successive logins keeps one client's cookie from
     * leaking into the next.
     *
     * @return array{cookie: \Symfony\Component\HttpFoundation\Cookie, id: string}
     */
    private function loginSession(string $email, string $password): array {
        $this->app['auth']->forgetGuards();
        // Restore the DEFAULT guard as well, not just the resolved instances. `auth:sanctum`
        // calls shouldUse('sanctum'), which sticks for the rest of the process, so a second
        // login in the same test would reach RequestGuard::attempt() — which does not exist.
        // Hard-coded 'web' rather than read from config: shouldUse() OVERWRITES
        // auth.defaults.guard, so by now that key holds 'sanctum' and reading it back would
        // restore nothing. A real browser gets a fresh process here; the test has to say so.
        $this->app['auth']->shouldUse('web');
        $response = $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => $email, 'password' => $password]);
        $response->assertOk();
        $cookie = $response->getCookie((string) config('session.cookie'), false);
        $id = (string) $response->getCookie((string) config('session.cookie'), true)->getValue();
        Cookie::flushQueuedCookies();

        return ['cookie' => $cookie, 'id' => $id];
    }

    /**
     * Replay a captured session cookie on the next request. `forgetGuards()` is required for
     * the same reason `actAsFreshClient` needs it: the guard singleton caches whichever user
     * its LAST resolution found, and a single test process shares that singleton across every
     * request it makes — a real browser never does.
     */
    private function withSessionCookie(\Symfony\Component\HttpFoundation\Cookie $cookie): self {
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withUnencryptedCookie($cookie->getName(), $cookie->getValue());
    }

    /**
     * Every `users` column except the two this feature is allowed to move — read from the
     * live schema, not a hand-written list (SC-007). Mirrors PasswordResetControllerTest's
     * helper of the same name.
     *
     * @return array<string, mixed>
     */
    private function userSnapshot(User $user): array {
        $row = (array) DB::table('users')->where('id', $user->id)->first();
        // Only the two columns the change is ALLOWED to move are excluded. `updated_at` is
        // deliberately NOT excluded: FR-034 says a password change leaves no record of when
        // it happened, and Eloquent's timestamp would be exactly such a record, so
        // PasswordService suppresses it for that save and this assertion is what proves it.
        unset($row['password'], $row['remember_token']);

        return $row;
    }

    /**
     * Act as a fresh client for $user: a second owner is a second browser, and three pieces
     * of process state would otherwise leak between them here — the shared session (whose
     * stored password hash makes Sanctum's AuthenticateSession tear the second client down),
     * the guards' already-resolved user (Sanctum's RequestGuard caches it, where a real
     * request resolves it once and dies), and the default guard, which auth:sanctum has by
     * now switched to `sanctum`. None of the three exists in production, where every request
     * boots its own container.
     */
    private function actAsFreshClient(User $user): self {
        $this->flushSession();
        $this->app['auth']->forgetGuards();

        return $this->actingAs($user, 'web');
    }

    /**
     * Point the default guard back at `web` mid-test.
     *
     * A feature test shares ONE application across its requests, so the `shouldUse('sanctum')`
     * that the auth:sanctum middleware performs on an authenticated request outlives that
     * request here in a way it never can in production, where every request boots its own
     * container. Without this, a later anonymous `POST /api/login` would call `Auth::attempt`
     * on Sanctum's RequestGuard, which has no such method.
     */
    private function useWebGuard(): void {
        $this->app['auth']->shouldUse('web');
    }

    /**
     * A change attempt that cannot succeed, for the rate-limit cases: the current password
     * is wrong, so every call is a 422 and the stored credential never moves.
     *
     * @return array<string, string>
     */
    private function guess(): array {
        return [
            'current_password' => 'GuessedPassw0rd',
            'password' => 'NewPassw0rd',
            'password_confirmation' => 'NewPassw0rd',
        ];
    }

    public function test_user_never_exposes_its_own_rating(): void {
        // FR-022: an account cannot read its own rating either — knowing the exact
        // distance to the auto-activation threshold is itself the moderation signal.
        $user = User::factory()->create();
        $user->rating = 12;
        $user->save();

        $response = $this->actingAs($user)->getJson('/api/user');

        $response->assertOk();
        $this->assertArrayNotHasKey('rating', $response->json('data'));
    }

    public function test_register_ignores_a_submitted_rating(): void {
        // FR-003: rating is out of $fillable, so no request body can hand an account
        // the trust threshold and bypass moderation.
        $response = $this->postJson('/api/register', [
            'name' => 'Ratingseeker',
            'email' => 'seeker@example.com',
            'password' => 'Password123',
            'password_confirmation' => 'Password123',
            'rating' => 9999,
        ]);

        $response->assertCreated();
        $this->assertSame(0, User::where('email', 'seeker@example.com')->firstOrFail()->rating);
    }

    public function test_user_returns_null_for_an_anonymous_request(): void {
        $response = $this->getJson('/api/user');

        // Anonymous is reported as data:null (200), never a 401, so the SPA can probe
        // auth state on load without treating "logged out" as an error (FR-005).
        $response->assertOk();
        $response->assertExactJson(['data' => null]);
    }
}
