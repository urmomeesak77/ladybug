<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Resources;

use App\Http\Resources\UserResource;
use App\Models\User;
use App\Models\UserIdentity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class UserResourceTest extends TestCase {
    use RefreshDatabase;

    public function test_it_exposes_only_the_safe_public_fields_in_order(): void {
        $user = User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
        ]);

        $data = (new UserResource($user))->toArray(Request::create('/'));

        // Feature 017 (FR-029) appends `has_password` and `google_linked_at`. This list is
        // exhaustive on purpose — it is the assertion that would catch a field being added
        // to the payload without anyone deciding it was safe to disclose.
        $this->assertSame(
            [
                'hash', 'name', 'email', 'email_verified_at', 'role', 'created_at', 'updated_at',
                'has_password', 'google_linked_at',
            ],
            array_keys($data),
        );
        $this->assertSame($user->hash, $data['hash']);
        $this->assertSame('Ada Lovelace', $data['name']);
        $this->assertSame('ada@example.com', $data['email']);
        // A default factory account is a member; the payload exposes the enum's value (FR-007).
        $this->assertSame('member', $data['role']);
    }

    public function test_it_never_exposes_the_password_or_remember_token(): void {
        $user = User::factory()->create();

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertArrayNotHasKey('password', $data);
        $this->assertArrayNotHasKey('remember_token', $data);
        $this->assertArrayNotHasKey('id', $data);
    }

    public function test_a_password_account_reports_a_password_and_no_google_link(): void {
        $user = User::factory()->create();

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertTrue($data['has_password']);
        $this->assertNull($data['google_linked_at']);
    }

    public function test_a_google_only_account_reports_the_link_and_no_password(): void {
        $user = User::factory()->googleOnly()->create();
        $identity = UserIdentity::factory()->for($user)->create();

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertFalse($data['has_password']);
        // The link's own created_at, not the account's — the account page states when the
        // Google door was attached, which on a US3 auto-link is later than the sign-up.
        $this->assertTrue($identity->created_at->equalTo($data['google_linked_at']));
    }

    public function test_a_linked_password_account_reports_both_doors(): void {
        $user = User::factory()->create();
        UserIdentity::factory()->for($user)->create();

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertTrue($data['has_password']);
        $this->assertNotNull($data['google_linked_at']);
    }

    /**
     * FR-022 / SC-009: the provider's subject identifier is the sole key to an account
     * at Google and never leaves the server — not even to the account's own owner, who
     * is the only person this resource is ever rendered for.
     */
    public function test_it_never_exposes_the_provider_subject_identifier(): void {
        $user = User::factory()->googleOnly()->create();
        $identity = UserIdentity::factory()->for($user)->create();

        $json = json_encode((new UserResource($user))->toArray(Request::create('/')));

        $this->assertArrayNotHasKey('provider_user_id', (array) json_decode((string) $json, true));
        $this->assertStringNotContainsString($identity->provider_user_id, (string) $json);
    }
}
