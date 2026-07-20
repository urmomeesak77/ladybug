<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Live-session revocation (FR-014, research D3): EnsureAccountEnabled sits in the api group,
 * so a disabled account's very next request is refused with 401 and the disabled message,
 * while an active or unauthenticated caller passes through untouched. The middleware also
 * tears the session down (logout + invalidate + token rotation); that cross-request cookie
 * replay is not observable under the array session driver the test guard uses (see
 * AuthControllerTest::test_logout_succeeds…), so the live-session smoke lives in the
 * Playwright slice — here we prove the per-request contract that gates access.
 */
final class EnsureAccountEnabledTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Present as the SPA so the stateful session guard runs the browser path.
        $this->withHeader('Origin', 'http://localhost');
    }

    public function test_a_disabled_users_next_request_is_refused_with_the_disabled_message(): void {
        $disabled = User::factory()->disabled()->create();

        $response = $this->actingAs($disabled)->getJson('/api/user');

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'This account is disabled.']);
    }

    public function test_a_disabled_users_logout_is_answered_401_by_the_middleware(): void {
        // Research D3: the middleware refuses the request before AuthController::logout runs,
        // and has already done the session teardown, so /logout answers 401 rather than its
        // usual success — intentional, and invisible to the SPA (any non-ok probe reads as
        // anonymous). No route exemption, because that is how a route later gets forgotten.
        $disabled = User::factory()->disabled()->create();

        $response = $this->actingAs($disabled)->postJson('/api/logout');

        $response->assertStatus(401);
        $response->assertExactJson(['message' => 'This account is disabled.']);
    }

    public function test_an_active_user_passes_through(): void {
        $active = User::factory()->create();

        $this->actingAs($active)->getJson('/api/user')->assertOk();
    }

    public function test_an_unauthenticated_request_passes_through_untouched(): void {
        // No user resolves, so the middleware is a pass-through: the public probe still
        // answers data:null (200), never 401.
        $this->getJson('/api/user')->assertOk()->assertExactJson(['data' => null]);
    }
}
