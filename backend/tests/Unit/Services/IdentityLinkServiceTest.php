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

    /**
     * An account that has already signed in with Google once, and the link that
     * recognises it. The claim values match self::identity()'s defaults, so a test can
     * assert either that they were kept or that a changed claim did not overwrite them.
     */
    private function returningVisitor(): User {
        $user = User::factory()->googleOnly()->create([
            'name' => 'A Visitor',
            'email' => 'visitor@example.com',
        ]);
        UserIdentity::factory()->for($user)->create(['provider_user_id' => self::SUB]);

        return $user;
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

    // ------------------------------------------- steps 2-3: the returning visitor

    public function test_a_returning_visitor_resolves_to_the_same_account(): void {
        $existing = $this->returningVisitor();

        $user = $this->service()->resolve($this->identity());

        // FR-009: the link is the answer, so no second account and no second link can
        // appear however many times the same person runs the flow.
        $this->assertSame($existing->id, $user->id);
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
    }

    public function test_a_returning_visitor_is_resolved_without_a_single_write(): void {
        $this->travel(-2)->days();
        $existing = $this->returningVisitor();
        $userUpdatedAt = $existing->updated_at;
        $linkUpdatedAt = UserIdentity::sole()->updated_at;
        $this->travelBack();

        $this->service()->resolve($this->identity());

        // Step 3 returns what it found and does nothing else. Both rows were written two
        // days ago, so any save at all on this path would drag a timestamp up to now.
        $this->assertTrue($userUpdatedAt->equalTo(User::sole()->updated_at));
        $this->assertTrue($linkUpdatedAt->equalTo(UserIdentity::sole()->updated_at));
    }

    public function test_a_changed_name_and_address_still_resolve_to_the_same_account(): void {
        $existing = $this->returningVisitor();

        $user = $this->service()->resolve($this->identity(email: 'moved@example.com', name: 'A Renamed Visitor'));

        // SC-003: the address is not the identifier. Changing it at Google is a change
        // to a profile elsewhere, not a change of person.
        $this->assertSame($existing->id, $user->id);
        $this->assertSame(1, User::count());
    }

    public function test_a_changed_claim_is_not_written_over_the_stored_profile(): void {
        $this->returningVisitor();

        $this->service()->resolve($this->identity(email: 'moved@example.com', name: 'A Renamed Visitor'));

        // Spec Assumptions: Ladybug's copy of the name and address belongs to the
        // account. Google is a door, not the source of truth for what is behind it.
        $stored = User::sole();
        $this->assertSame('visitor@example.com', $stored->email);
        $this->assertSame('A Visitor', $stored->name);
    }

    public function test_an_already_verified_account_is_not_verified_a_second_time(): void {
        $this->travel(-2)->days();
        $existing = $this->returningVisitor();
        $verifiedAt = $existing->email_verified_at;
        $this->travelBack();

        $this->service()->resolve($this->identity());

        // data-model.md §3: the stamp records when the address was FIRST confirmed. A
        // re-call would quietly rewrite it to now() on every single sign-in.
        $this->assertTrue($verifiedAt->equalTo(User::sole()->email_verified_at));
    }

    public function test_a_hard_deleted_account_leaves_its_person_a_new_visitor(): void {
        $gone = $this->returningVisitor();

        // A hard delete (feature 013 leaves no tombstone) takes the link with it,
        // because the FK cascades rather than nulling — FR-032.
        $gone->delete();
        $this->assertSame(0, UserIdentity::count());

        $user = $this->service()->resolve($this->identity());

        // US5 AS3: step 2 finds nothing, so the same Google account is simply a new
        // person. An ownerless link would instead refuse them an account forever under
        // UNIQUE (provider, provider_user_id), which is the whole reason for the cascade.
        $this->assertNotSame($gone->id, $user->id);
        $this->assertSame(1, User::count());
        $this->assertSame($user->id, UserIdentity::sole()->user_id);
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
