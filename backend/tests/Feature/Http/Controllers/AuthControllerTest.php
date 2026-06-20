<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $response->assertJsonStructure(['data' => ['id', 'name', 'email', 'created_at', 'updated_at']]);
        $response->assertJsonPath('data.email', 'ada@example.com');
        $this->assertArrayNotHasKey('password', $response->json('data'));
        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
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

    public function test_login_rejects_a_malformed_request(): void {
        $response = $this->postJson('/api/login', ['email' => 'not-an-email', 'password' => '']);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['email', 'password']);
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

    public function test_user_returns_null_for_an_anonymous_request(): void {
        $response = $this->getJson('/api/user');

        // Anonymous is reported as data:null (200), never a 401, so the SPA can probe
        // auth state on load without treating "logged out" as an error (FR-005).
        $response->assertOk();
        $response->assertExactJson(['data' => null]);
    }
}
