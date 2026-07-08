<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

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

    public function test_posts_returns_the_users_trashposts(): void {
        $user = User::factory()->create();
        $post = Trashpost::create(['hash' => 'mine000001', 'user_id' => $user->id]);
        Trashpost::create(['hash' => 'other00001']);

        $posts = $user->posts;

        $this->assertCount(1, $posts);
        $this->assertTrue($posts->first()->is($post));
    }
}
