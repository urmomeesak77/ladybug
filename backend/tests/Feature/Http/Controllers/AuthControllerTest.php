<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use App\Services\UserAdminService;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Notification;
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
    }

    public function test_login_with_remember_omitted_sets_no_remember_cookie(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $response = $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password']);

        $response->assertOk();
        $response->assertCookieMissing((string) config('remember.cookie'));
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
