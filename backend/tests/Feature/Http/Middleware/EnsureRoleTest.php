<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Exercises the `role:admin` gate exactly as the admin routes mount it: Sanctum
 * authenticates, then the gate authorizes by Role::rank. Guest → 401 (from
 * auth:sanctum), member → 403, admin/superuser → through.
 */
final class EnsureRoleTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();

        Route::middleware(['auth:sanctum', 'role:admin'])
            ->get('/_test/role-admin', static fn () => response()->json(['ok' => true]));
    }

    public function test_guest_is_unauthenticated(): void {
        $this->getJson('/_test/role-admin')->assertUnauthorized();
    }

    public function test_member_is_forbidden(): void {
        $member = User::factory()->create();

        $this->actingAs($member)->getJson('/_test/role-admin')->assertForbidden();
    }

    public function test_admin_is_admitted(): void {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->getJson('/_test/role-admin')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_superuser_is_admitted(): void {
        $superuser = User::factory()->superuser()->create();

        $this->actingAs($superuser)->getJson('/_test/role-admin')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }
}
