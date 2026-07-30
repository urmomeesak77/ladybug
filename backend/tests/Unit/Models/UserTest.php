<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Enums\Role;
use App\Models\Trashpost;
use App\Models\User;
use App\Models\UserIdentity;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
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

    public function test_an_account_without_a_disabled_at_is_not_disabled(): void {
        $user = User::factory()->create();

        $this->assertNull($user->disabled_at);
        $this->assertFalse($user->isDisabled());
    }

    public function test_an_account_with_a_disabled_at_is_disabled(): void {
        $user = User::factory()->disabled()->create();

        $this->assertTrue($user->fresh()->isDisabled());
    }

    public function test_disabled_at_is_cast_to_a_datetime(): void {
        $user = User::factory()->disabled()->create();

        $this->assertSame('datetime', (new User())->getCasts()['disabled_at']);
        $this->assertInstanceOf(CarbonInterface::class, $user->fresh()->disabled_at);
    }

    public function test_disabled_by_resolves_to_the_acting_account(): void {
        $actor = User::factory()->admin()->create();
        $user = User::factory()->disabled($actor)->create();

        $this->assertTrue($user->fresh()->disabledBy->is($actor));
    }

    public function test_disabled_by_is_null_when_the_actor_is_unresolvable(): void {
        // The FK is nullOnDelete, so a deleted moderator degrades the row to "disabled
        // by nobody we can name" rather than orphaning it (data-model INV-3).
        $user = User::factory()->disabled()->create();

        $this->assertNull($user->fresh()->disabled_by);
        $this->assertNull($user->fresh()->disabledBy);
    }

    public function test_disabled_columns_are_not_mass_assignable(): void {
        // Same guard as `role`/`rating` (Principle VI): no request body may disable
        // or re-enable an account — only UserAdminService writes these (INV-2).
        $fillable = (new User())->getFillable();

        $this->assertNotContains('disabled_at', $fillable);
        $this->assertNotContains('disabled_by', $fillable);
    }

    public function test_google_identity_resolves_the_google_link(): void {
        $user = User::factory()->create();
        $identity = UserIdentity::factory()->create(['user_id' => $user->id]);

        $this->assertTrue($user->fresh()->googleIdentity->is($identity));
    }

    public function test_google_identity_ignores_a_link_from_another_provider(): void {
        // The relation is constrained to provider = 'google', so a second provider
        // added later cannot be mistaken for a Google link (data-model §1).
        $user = User::factory()->create();
        UserIdentity::factory()->create(['user_id' => $user->id, 'provider' => 'github']);

        $this->assertNull($user->fresh()->googleIdentity);
    }

    public function test_google_identity_picks_the_google_link_out_of_several_providers(): void {
        $user = User::factory()->create();
        UserIdentity::factory()->create(['user_id' => $user->id, 'provider' => 'github']);
        $google = UserIdentity::factory()->create(['user_id' => $user->id, 'provider' => 'google']);

        $this->assertTrue($user->fresh()->googleIdentity->is($google));
    }

    public function test_an_account_with_no_link_has_no_google_identity(): void {
        $this->assertNull(User::factory()->create()->googleIdentity);
    }

    public function test_the_google_only_state_is_a_verified_passwordless_member(): void {
        // The fixture for every Google-created account (data-model §9): no password
        // at all, already verified because Google confirmed the address (FR-014),
        // and the ordinary member role (FR-013).
        $user = User::factory()->googleOnly()->create()->fresh();

        $this->assertNull($user->password);
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame(Role::Member, $user->role);
    }

    public function test_hashing_fails_closed_on_an_absent_stored_hash(): void {
        // FR-020's second guard is framework behaviour, and a security requirement
        // resting on an unasserted framework internal is one upgrade away from being
        // false (research D6). Auth::attempt() reaches Hash::check() with the stored
        // hash, so these two returns are what stop a passwordless account being
        // signed into by the password form.
        $this->assertFalse(Hash::check('', null));
        $this->assertFalse(Hash::check('', ''));
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
