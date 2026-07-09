<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

final class MakeSuperuserCommandTest extends TestCase {
    use RefreshDatabase;

    public function test_it_promotes_a_member_to_superuser_by_email(): void {
        // A default member is the starting point (FR-004); the operator bootstraps
        // the first superuser off it by email, never by DB id (SC-005 / FR-009).
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $this->assertSame(Role::Member, $user->role);

        $exit = Artisan::call('user:make-superuser', ['email' => 'ada@example.com']);

        $this->assertSame(0, $exit);
        $this->assertSame(Role::Superuser, $user->fresh()->role);
    }

    public function test_it_confirms_the_promotion_on_success(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        Artisan::call('user:make-superuser', ['email' => 'ada@example.com']);

        $this->assertStringContainsString('ada@example.com', Artisan::output());
    }

    public function test_an_unknown_email_errors_and_changes_nothing(): void {
        User::factory()->create(['email' => 'ada@example.com']);

        $exit = Artisan::call('user:make-superuser', ['email' => 'nobody@example.com']);

        $this->assertSame(1, $exit);
        // No account was touched — the only user keeps its member role.
        $this->assertSame(0, User::where('role', Role::Superuser->value)->count());
        $this->assertStringContainsString('nobody@example.com', Artisan::output());
    }

    public function test_promoting_an_existing_superuser_is_idempotent(): void {
        $user = User::factory()->superuser()->create(['email' => 'ada@example.com']);

        $exit = Artisan::call('user:make-superuser', ['email' => 'ada@example.com']);

        $this->assertSame(0, $exit);
        $this->assertSame(Role::Superuser, $user->fresh()->role);
        $this->assertStringContainsString('already', strtolower(Artisan::output()));
    }
}
