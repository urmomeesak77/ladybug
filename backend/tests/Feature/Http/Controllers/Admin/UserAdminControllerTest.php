<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers\Admin;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The account-list index endpoint as an admin (US1): the documented paginator envelope over
 * every account, newest-first, 100/page. A non-numeric, missing or below-1 page falls back
 * to page 1; a page beyond the last is an empty page, not an error. Access-control cases
 * (guest/member/superuser) and the disable/enable actions land in US2/US3.
 */
final class UserAdminControllerTest extends TestCase {
    use RefreshDatabase;

    private function admin(): User {
        return User::factory()->admin()->create();
    }

    public function test_index_returns_the_documented_row_shape_and_meta(): void {
        User::factory()->create();

        $response = $this->actingAs($this->admin())->getJson('/api/admin/users');

        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [['hash', 'name', 'email', 'role', 'email_verified_at', 'created_at', 'disabled_at', 'disabled_by']],
            'meta' => ['current_page', 'last_page', 'per_page', 'total'],
        ]);
        $response->assertJsonPath('meta.per_page', 100);
    }

    public function test_index_orders_accounts_newest_first(): void {
        $older = User::factory()->create(['created_at' => now()->subDay()]);
        $newer = User::factory()->create(['created_at' => now()]);

        $response = $this->actingAs($this->admin())->getJson('/api/admin/users');

        // The acting admin is itself the newest row (created during this request), so match
        // the two seeded accounts by hash rather than fixed offsets.
        $hashes = $response->assertOk()->json('data.*.hash');
        $this->assertLessThan(array_search($older->hash, $hashes, true), array_search($newer->hash, $hashes, true));
    }

    public function test_index_serializes_a_disabled_row_with_the_actors_name(): void {
        $actor = User::factory()->admin()->create(['name' => 'Root']);
        $target = User::factory()->disabled($actor)->create();

        $response = $this->actingAs($this->admin())->getJson('/api/admin/users');

        $response->assertOk();
        $row = collect($response->json('data'))->firstWhere('hash', $target->hash);
        $this->assertNotNull($row['disabled_at']);
        $this->assertSame('Root', $row['disabled_by']);
    }

    public function test_index_second_page_returns_the_next_slice(): void {
        User::factory()->count(101)->create();

        $response = $this->actingAs($this->admin())->getJson('/api/admin/users?page=2');

        $response->assertOk();
        $response->assertJsonPath('meta.current_page', 2);
        // 101 seeded + the acting admin = 102 accounts, so page 2 carries the overflow.
        $this->assertGreaterThanOrEqual(1, count($response->json('data')));
    }

    public function test_index_page_beyond_the_last_is_an_empty_page_not_an_error(): void {
        User::factory()->count(2)->create();

        $response = $this->actingAs($this->admin())->getJson('/api/admin/users?page=9');

        $response->assertOk();
        $response->assertJsonCount(0, 'data');
    }

    public function test_index_falls_back_to_page_one_for_a_non_numeric_page(): void {
        $response = $this->actingAs($this->admin())->getJson('/api/admin/users?page=abc');

        $response->assertOk()->assertJsonPath('meta.current_page', 1);
    }

    public function test_index_falls_back_to_page_one_for_a_below_one_page(): void {
        $response = $this->actingAs($this->admin())->getJson('/api/admin/users?page=0');

        $response->assertOk()->assertJsonPath('meta.current_page', 1);
    }
}
