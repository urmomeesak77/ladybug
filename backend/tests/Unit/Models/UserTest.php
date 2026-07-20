<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Enums\Role;
use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class UserTest extends TestCase {
    use RefreshDatabase;

    public function test_mass_assignable_attributes(): void {
        $user = new User();

        $this->assertSame(['name', 'email', 'password'], $user->getFillable());
    }

    public function test_sensitive_attributes_are_hidden(): void {
        $hidden = (new User())->getHidden();

        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);
    }

    public function test_casts_secure_sensitive_attributes(): void {
        $casts = (new User())->getCasts();

        $this->assertSame('hashed', $casts['password']);
        $this->assertSame('datetime', $casts['email_verified_at']);
    }

    public function test_setting_the_email_maintains_its_sha1_digest(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);

        // The digest column is what lets a session-free verification link find
        // its account (the link's {hash} segment is sha1 of the address).
        $this->assertSame(sha1('ada@example.com'), $user->fresh()->email_sha1);

        $user->email = 'countess@example.com';
        $user->save();

        $this->assertSame(sha1('countess@example.com'), $user->fresh()->email_sha1);
    }

    public function test_hash_can_be_set_and_read(): void {
        $user = User::factory()->create(['hash' => 'usr0000001']);

        $this->assertSame('usr0000001', $user->fresh()->hash);
    }

    public function test_a_new_user_defaults_to_the_member_role(): void {
        // The default attribute pins brand-new accounts to member before any
        // save (FR-004) — no request body or factory state is involved.
        $this->assertSame(Role::Member, (new User())->role);
    }

    public function test_a_created_user_defaults_to_the_member_role(): void {
        $user = User::factory()->create();

        $this->assertSame(Role::Member, $user->fresh()->role);
    }

    public function test_role_is_cast_to_the_role_enum(): void {
        $user = User::factory()->create();

        $this->assertInstanceOf(Role::class, $user->role);
        $this->assertInstanceOf(Role::class, $user->fresh()->role);
    }

    public function test_role_is_not_mass_assignable(): void {
        // Privilege-escalation guard (Principle VI): a request body key of `role`
        // is silently discarded, so the account keeps its member default.
        $user = new User();
        $user->fill(['role' => 'superuser']);

        $this->assertSame(Role::Member, $user->role);
    }

    public function test_an_unverified_user_still_defaults_to_the_member_role(): void {
        // Role is independent of e-mail verification (FR-011).
        $user = User::factory()->unverified()->create();

        $this->assertNull($user->email_verified_at);
        $this->assertSame(Role::Member, $user->fresh()->role);
    }

    public function test_a_created_user_starts_at_rating_zero(): void {
        // Every account opens its record at zero (FR-001); the column default
        // also backfills the accounts that predate the rating (FR-002).
        $user = User::factory()->create();

        $this->assertSame(0, $user->fresh()->rating);
    }

    public function test_rating_is_not_mass_assignable(): void {
        // Same guard as `role`: a request body key of `rating` is discarded, so
        // no one can grant themselves the auto-activation threshold (FR-003).
        $user = User::factory()->create();
        $user->fill(['rating' => 999]);
        $user->save();

        $this->assertSame(0, $user->fresh()->rating);
    }

    public function test_posts_returns_the_users_trashposts(): void {
        $user = User::factory()->create();
        // hash/user_id are no longer mass assignable (see Trashpost::$fillable),
        // so they are set explicitly here.
        $post = new Trashpost();
        $post->hash = 'mine000001';
        $post->user_id = $user->id;
        $post->save();
        $other = new Trashpost();
        $other->hash = 'other00001';
        $other->save();

        $posts = $user->posts;

        $this->assertCount(1, $posts);
        $this->assertTrue($posts->first()->is($post));
    }
}
