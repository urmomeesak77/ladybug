<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Resources;

use App\Http\Resources\AdminUserResource;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * The admin-only account row projection (data-model §3): hash, name, email, role,
 * email_verified_at, created_at, disabled_at, disabled_by — and nothing internal. The
 * database id, password, remember_token, email_sha1 and rating never leave the backend
 * (Principle V/VI). disabled_by is serialized as the acting account's NAME, never an id
 * (INV-3); the timestamps are raw MySQL datetimes (Y-m-d H:i:s) or an explicit null.
 */
final class AdminUserResourceTest extends TestCase {
    use RefreshDatabase;

    /**
     * @return array<string, mixed>
     */
    private function toArray(User $user): array {
        return (new AdminUserResource($user))->toArray(Request::create('/'));
    }

    public function test_exposes_the_documented_row_shape(): void {
        $user = User::factory()->create();

        $row = $this->toArray($user);

        $this->assertSame(
            ['hash', 'name', 'email', 'role', 'email_verified_at', 'created_at', 'disabled_at', 'disabled_by'],
            array_keys($row),
        );
    }

    public function test_carries_the_public_row_values(): void {
        $user = User::factory()->create(['name' => 'Ada', 'email' => 'ada@example.com']);

        $row = $this->toArray($user);

        $this->assertSame($user->hash, $row['hash']);
        $this->assertSame('Ada', $row['name']);
        $this->assertSame('ada@example.com', $row['email']);
        $this->assertSame('member', $row['role']);
    }

    public function test_omits_every_internal_field(): void {
        $row = $this->toArray(User::factory()->create());

        foreach (['id', 'password', 'remember_token', 'email_sha1', 'rating'] as $internal) {
            $this->assertArrayNotHasKey($internal, $row);
        }
    }

    public function test_timestamps_are_raw_mysql_datetimes(): void {
        $createdAt = now()->setTime(9, 30, 44);
        $verifiedAt = now()->setTime(9, 31, 2);
        $user = User::factory()->create(['created_at' => $createdAt, 'email_verified_at' => $verifiedAt]);

        $row = $this->toArray($user);

        $this->assertSame($createdAt->format('Y-m-d H:i:s'), $row['created_at']);
        $this->assertSame($verifiedAt->format('Y-m-d H:i:s'), $row['email_verified_at']);
    }

    public function test_unverified_account_reports_a_null_verified_at_never_omitted(): void {
        $row = $this->toArray(User::factory()->unverified()->create());

        $this->assertNull($row['email_verified_at']);
        $this->assertArrayHasKey('email_verified_at', $row);
    }

    public function test_an_active_account_reports_null_disabled_columns(): void {
        $row = $this->toArray(User::factory()->create());

        $this->assertNull($row['disabled_at']);
        $this->assertNull($row['disabled_by']);
    }

    public function test_disabled_at_is_a_raw_mysql_datetime(): void {
        $disabledAt = now()->setTime(11, 20, 0);
        $actor = User::factory()->admin()->create();
        $user = User::factory()->create(['disabled_at' => $disabledAt, 'disabled_by' => $actor->id]);
        $user->load('disabledBy');

        $this->assertSame($disabledAt->format('Y-m-d H:i:s'), $this->toArray($user)['disabled_at']);
    }

    public function test_disabled_by_is_the_actors_name_not_an_id(): void {
        $actor = User::factory()->admin()->create(['name' => 'Root']);
        $user = User::factory()->disabled($actor)->create();
        $user->load('disabledBy');

        $this->assertSame('Root', $this->toArray($user)['disabled_by']);
    }

    public function test_disabled_by_degrades_to_null_when_the_actor_is_unresolvable(): void {
        // INV-3 / nullOnDelete: a disabled row whose acting account has since gone
        // shows the timestamp but no actor — the resource never leaks the raw id.
        $user = User::factory()->create(['disabled_at' => now(), 'disabled_by' => null]);
        $user->load('disabledBy');

        $row = $this->toArray($user);
        $this->assertNotNull($row['disabled_at']);
        $this->assertNull($row['disabled_by']);
    }
}
