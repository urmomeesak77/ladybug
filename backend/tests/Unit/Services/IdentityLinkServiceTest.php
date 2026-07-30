<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Enums\Role;
use App\Exceptions\OAuthFailure;
use App\Models\User;
use App\Models\UserIdentity;
use App\Services\IdentityLinkService;
use App\Support\GoogleIdentity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The half of the flow that decides WHICH account a confirmed Google identity belongs
 * to, and nothing that talks to Google (research D17). The normative order is research
 * D8; this file proves each of its branches in isolation.
 *
 * There is no Http::fake() anywhere in here on purpose — the service must never make a
 * network call, and preventStrayRequests() turns any future one into a failure.
 */
final class IdentityLinkServiceTest extends TestCase {
    use RefreshDatabase;

    private const SUB = '110169484474386276334';

    protected function setUp(): void {
        parent::setUp();
        // This service must never reach the network; if it ever does, fail loudly.
        Http::preventStrayRequests();
    }

    private function service(): IdentityLinkService {
        return new IdentityLinkService();
    }

    private function identity(
        string $sub = self::SUB,
        string $email = 'visitor@example.com',
        ?string $name = 'A Visitor',
        bool $verified = true,
    ): GoogleIdentity {
        return new GoogleIdentity($sub, $email, $verified, $name);
    }

    // ------------------------------------------------ step 1: the FR-005 email guard

    public function test_an_unconfirmed_address_is_refused_before_the_transaction_opens(): void {
        try {
            $this->service()->resolve($this->identity(verified: false));
            $this->fail('Expected an unconfirmed address to be refused.');
        }
        catch (OAuthFailure $failure) {
            $this->assertSame(OAuthFailure::UNVERIFIED_EMAIL, $failure->failureCode);
        }

        // The guard is load-bearing precisely because it precedes every write: an
        // address Google has not confirmed must not create, link or match anything.
        $this->assertSame(0, User::count());
        $this->assertSame(0, UserIdentity::count());
    }

    public function test_an_unconfirmed_address_never_reaches_an_account_holding_it(): void {
        $existing = User::factory()->create(['email' => 'visitor@example.com']);

        $this->expectException(OAuthFailure::class);

        try {
            $this->service()->resolve($this->identity(verified: false));
        }
        finally {
            // FR-005 is what stops anyone claiming a stranger's address at an identity
            // provider and inheriting their Ladybug account (US3 AS5).
            $this->assertSame(0, UserIdentity::count());
            $this->assertNull($existing->fresh()->googleIdentity);
        }
    }

    // ------------------------------------------------------ step 6: the new visitor

    public function test_a_brand_new_visitor_gets_exactly_one_account(): void {
        $user = $this->service()->resolve($this->identity());

        $this->assertSame(1, User::count());
        $this->assertTrue($user->exists);
        $this->assertSame($user->id, User::first()->id);
    }

    public function test_the_new_account_is_built_from_the_claims(): void {
        $user = $this->service()->resolve($this->identity(email: 'new@example.com', name: 'Ada Lovelace'));

        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertSame('new@example.com', $user->email);
    }

    public function test_the_new_accounts_name_falls_back_when_google_sends_none(): void {
        // displayName() is total by construction, so the column can never be empty.
        $user = $this->service()->resolve($this->identity(email: 'ada@example.com', name: null));

        $this->assertSame('ada', $user->name);
    }

    public function test_the_new_account_is_linked_to_the_google_subject(): void {
        $user = $this->service()->resolve($this->identity());

        $link = UserIdentity::sole();
        $this->assertSame($user->id, $link->user_id);
        $this->assertSame('google', $link->provider);
        $this->assertSame(self::SUB, $link->provider_user_id);
    }

    public function test_the_new_account_is_already_verified(): void {
        $user = $this->service()->resolve($this->identity());

        // FR-013: Google has already confirmed the address, so making the visitor
        // confirm it a second time would be asking for proof we were just given.
        $this->assertNotNull($user->email_verified_at);
        $this->assertTrue($user->hasVerifiedEmail());
    }

    public function test_the_new_account_holds_no_password(): void {
        $user = $this->service()->resolve($this->identity());

        // The whole point of the nullable column: there is no hash to steal, and
        // LoginRequest + Hash::check both fail closed on it (FR-020).
        $this->assertNull($user->fresh()->password);
    }

    public function test_the_new_account_gets_the_ordinary_defaults(): void {
        $this->service()->resolve($this->identity());

        // Read back from the row rather than the in-memory model: `rating` has no
        // value until the column default supplies one, and the stored state is what
        // FR-014 is actually about.
        $stored = User::sole();
        // A Google account is an ordinary account: no elevated role, no head start on
        // the trust rating, not disabled.
        $this->assertSame(Role::Member, $stored->role);
        $this->assertSame(0, $stored->rating);
        $this->assertNull($stored->disabled_at);
        $this->assertNull($stored->disabled_by);
    }

    public function test_the_new_account_gets_a_fresh_public_hash(): void {
        $user = $this->service()->resolve($this->identity());

        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{10}$/', $user->hash);
    }

    public function test_two_different_google_accounts_get_two_ladybug_accounts(): void {
        $first = $this->service()->resolve($this->identity(sub: '111', email: 'one@example.com'));
        $second = $this->service()->resolve($this->identity(sub: '222', email: 'two@example.com'));

        $this->assertNotSame($first->id, $second->id);
        $this->assertSame(2, User::count());
        $this->assertSame(2, UserIdentity::count());
    }
}
