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
}
