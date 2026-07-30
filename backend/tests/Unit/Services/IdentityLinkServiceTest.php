<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Enums\Role;
use App\Exceptions\OAuthFailure;
use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use App\Models\UserIdentity;
use App\Services\IdentityLinkService;
use App\Support\GoogleIdentity;
use Illuminate\Database\Events\TransactionRolledBack;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use PDOException;
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

    /**
     * Run the flow and assert it was refused as disabled. Written as a helper because
     * the "writes nothing" tests below are about the blast radius rather than the code,
     * and must still fail — rather than silently assert a path that was never refused —
     * if the guard is ever removed.
     */
    private function assertRefused(GoogleIdentity $identity): void {
        try {
            $this->service()->resolve($identity);
            $this->fail('Expected a disabled account to be refused.');
        }
        catch (OAuthFailure $failure) {
            $this->assertSame(OAuthFailure::DISABLED, $failure->failureCode);
        }
    }

    /** That same returning visitor, after an administrator revoked its access. */
    private function disabledReturningVisitor(): User {
        $user = User::factory()->googleOnly()->disabled()->create([
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

    public function test_a_disabled_account_is_refused_at_its_own_link(): void {
        $existing = $this->disabledReturningVisitor();

        try {
            $this->service()->resolve($this->identity());
            $this->fail('Expected a disabled account to be refused at the Google door.');
        }
        catch (OAuthFailure $failure) {
            // FR-017, US5 AS1: access revocation that covers only one of two front doors
            // is not access revocation. The link is not a way around the administrator.
            $this->assertSame(OAuthFailure::DISABLED, $failure->failureCode);
        }

        $this->assertNotNull($existing->fresh()->disabled_at);
    }

    public function test_the_refusal_at_the_link_writes_nothing(): void {
        $this->travel(-2)->days();
        $existing = $this->disabledReturningVisitor();
        $userUpdatedAt = $existing->updated_at;
        $linkUpdatedAt = UserIdentity::sole()->updated_at;
        $this->travelBack();

        $this->assertRefused($this->identity());

        // SC-006: the guard sits above the return and below the lookup, so a refusal is
        // reached before the first write rather than cleaned up after one. Both rows were
        // written two days ago, so any save at all would drag a timestamp up to now.
        $this->assertTrue($userUpdatedAt->equalTo(User::sole()->updated_at));
        $this->assertTrue($linkUpdatedAt->equalTo(UserIdentity::sole()->updated_at));
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
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

    // -------------------------------------------- steps 4-5: the address collision

    /**
     * An ordinary password account holding the address the claim carries. Everything
     * about it is deliberately non-default, so a test asserting "unchanged" is asserting
     * that the real values survived rather than that two defaults happen to match.
     */
    private function passwordAccount(): User {
        return User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'visitor@example.com',
            'rating' => 42,
        ]);
    }

    public function test_an_address_already_on_an_account_resolves_to_that_account(): void {
        $existing = $this->passwordAccount();

        $user = $this->service()->resolve($this->identity());

        // FR-011: one person, one account, two doors. Google has confirmed the address,
        // so the account holding it is theirs and a second one would be a duplicate.
        $this->assertSame($existing->id, $user->id);
        $this->assertSame(1, User::count());
    }

    public function test_the_collision_attaches_the_link_to_the_existing_account(): void {
        $existing = $this->passwordAccount();

        $this->service()->resolve($this->identity());

        $link = UserIdentity::sole();
        $this->assertSame($existing->id, $link->user_id);
        $this->assertSame('google', $link->provider);
        $this->assertSame(self::SUB, $link->provider_user_id);
    }

    public function test_the_collision_leaves_the_password_byte_for_byte_unchanged(): void {
        $existing = $this->passwordAccount();
        $hash = $existing->password;

        $this->service()->resolve($this->identity());

        // FR-015, SC-004: linking adds a second door, it does not close the first. The
        // stored hash is compared byte for byte because a rehash would still verify.
        $this->assertSame($hash, User::sole()->password);
    }

    public function test_the_collision_leaves_the_rest_of_the_account_unchanged(): void {
        $existing = $this->passwordAccount();

        $this->service()->resolve($this->identity(name: 'A Renamed Visitor'));

        // FR-015: the only writes on this path are the link insert and, conditionally,
        // the verification stamp. Nothing Google sends overwrites the stored profile.
        $stored = User::sole();
        $this->assertSame('Ada Lovelace', $stored->name);
        $this->assertSame($existing->hash, $stored->hash);
        $this->assertSame($existing->role, $stored->role);
        $this->assertSame(42, $stored->rating);
        $this->assertNull($stored->disabled_at);
        $this->assertNull($stored->disabled_by);
    }

    public function test_the_collision_leaves_the_accounts_memes_and_comments_alone(): void {
        $existing = $this->passwordAccount();
        $post = Trashpost::factory()->create(['user_id' => $existing->id]);
        $comment = Comment::factory()->for($post)->create(['user_id' => $existing->id]);

        $this->service()->resolve($this->identity());

        // INV-6: the account's contents are not part of the linking rule at all — the
        // visitor signs in and finds everything exactly where they left it.
        $this->assertSame($existing->id, $post->fresh()->user_id);
        $this->assertSame($existing->id, $comment->fresh()->user_id);
        $this->assertSame(1, Trashpost::count());
        $this->assertSame(1, Comment::count());
    }

    public function test_an_unverified_account_is_verified_by_the_link(): void {
        User::factory()->unverified()->create(['email' => 'visitor@example.com']);

        $user = $this->service()->resolve($this->identity());

        // US3 AS4: the address was waiting on a confirmation e-mail that Google has now
        // made redundant — it just confirmed the very same address.
        $this->assertTrue($user->hasVerifiedEmail());
        $this->assertNotNull(User::sole()->email_verified_at);
    }

    public function test_an_already_verified_account_keeps_its_original_stamp(): void {
        $this->travel(-2)->days();
        $existing = $this->passwordAccount();
        $verifiedAt = $existing->email_verified_at;
        $this->travelBack();

        $this->service()->resolve($this->identity());

        // data-model.md §3: the stamp records when the address was FIRST confirmed, so
        // the write is conditional rather than unconditional (FR-015).
        $this->assertNotNull($verifiedAt);
        $this->assertTrue($verifiedAt->equalTo(User::sole()->email_verified_at));
    }

    public function test_an_account_already_linked_to_another_google_account_is_refused(): void {
        $existing = $this->passwordAccount();
        UserIdentity::factory()->for($existing)->create(['provider_user_id' => 'the-first-subject']);

        try {
            $this->service()->resolve($this->identity(sub: 'a-second-subject'));
            $this->fail('Expected a second Google account on one Ladybug account to be refused.');
        }
        catch (OAuthFailure $failure) {
            // FR-012, US3 AS6: one account, one Google account. Silently re-pointing the
            // link would hand whoever arrived second the keys to somebody else's account.
            $this->assertSame(OAuthFailure::ALREADY_LINKED, $failure->failureCode);
        }
    }

    public function test_the_already_linked_refusal_leaves_the_original_link_untouched(): void {
        $existing = $this->passwordAccount();
        $original = UserIdentity::factory()->for($existing)->create(['provider_user_id' => 'the-first-subject']);

        try {
            $this->service()->resolve($this->identity(sub: 'a-second-subject'));
        }
        catch (OAuthFailure) {
            // Asserted by the test above; here only the refusal's blast radius matters.
        }

        // The refusal precedes the write, so the account that was already linked is not
        // even touched, let alone re-pointed.
        $this->assertSame(1, UserIdentity::count());
        $stored = UserIdentity::sole();
        $this->assertSame($original->id, $stored->id);
        $this->assertSame('the-first-subject', $stored->provider_user_id);
    }

    public function test_a_disabled_account_matched_by_its_address_is_refused(): void {
        $existing = $this->passwordAccount();
        $existing->forceFill(['disabled_at' => now()])->save();

        try {
            $this->service()->resolve($this->identity());
            $this->fail('Expected a disabled account to be refused before it is linked.');
        }
        catch (OAuthFailure $failure) {
            // US5 AS4: the account is reachable by either door, so the guard is written
            // at both — the address path is not a way in around the link path's refusal.
            $this->assertSame(OAuthFailure::DISABLED, $failure->failureCode);
        }
    }

    public function test_the_refusal_by_address_stores_no_link(): void {
        $this->passwordAccount()->forceFill(['disabled_at' => now()])->save();

        $this->assertRefused($this->identity());

        // SC-006, INV-9: a disabled account must not silently acquire a link on a
        // sign-in it was always going to refuse — nor an account be created beside it.
        $this->assertSame(0, UserIdentity::count());
        $this->assertSame(1, User::count());
    }

    public function test_the_refusal_by_address_leaves_every_column_as_the_administrator_left_it(): void {
        $this->travel(-2)->days();
        $existing = User::factory()->unverified()->create([
            'name' => 'Ada Lovelace',
            'email' => 'visitor@example.com',
            'rating' => 42,
            'disabled_at' => now(),
        ]);
        $this->travelBack();

        $this->assertRefused($this->identity());

        // The account is deliberately unverified as well as disabled, because the
        // conditional verification stamp is the one write on this path that a guard
        // placed too low would still let through.
        $stored = User::sole();
        $this->assertNull($stored->email_verified_at);
        $this->assertSame('Ada Lovelace', $stored->name);
        $this->assertSame($existing->password, $stored->password);
        $this->assertSame($existing->hash, $stored->hash);
        $this->assertSame($existing->role, $stored->role);
        $this->assertSame(42, $stored->rating);
        $this->assertTrue($existing->disabled_at->equalTo($stored->disabled_at));
        $this->assertTrue($existing->updated_at->equalTo($stored->updated_at));
    }

    public function test_a_re_enabled_account_links_as_though_the_refusal_had_never_happened(): void {
        $existing = $this->passwordAccount();
        $existing->forceFill(['disabled_at' => now()])->save();

        $this->assertRefused($this->identity());

        $existing->forceFill(['disabled_at' => null])->save();
        $user = $this->service()->resolve($this->identity());

        // US5 AS5, FR-017's final clause: because the refusal wrote nothing, re-enabling
        // is the whole of the undo — there is no half-built link to clear first.
        $this->assertSame($existing->id, $user->id);
        $this->assertSame(1, User::count());
        $this->assertSame($existing->id, UserIdentity::sole()->user_id);
        $this->assertSame(self::SUB, UserIdentity::sole()->provider_user_id);
    }

    public function test_an_unconfirmed_address_does_not_verify_the_account_holding_it(): void {
        User::factory()->unverified()->create(['email' => 'visitor@example.com']);

        try {
            $this->service()->resolve($this->identity(verified: false));
        }
        catch (OAuthFailure) {
            // The code is asserted by the step-1 tests above.
        }

        // FR-005, US3 AS5: the collision branch is never entered, so an unconfirmed
        // claim cannot even hand a stranger's account a verification it never earned.
        $this->assertNull(User::sole()->email_verified_at);
        $this->assertSame(0, UserIdentity::count());
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

    // ------------------------------------ the concurrency backstop (research D8)

    /** Link inserts still to be refused the way a lost race would refuse them. */
    private int $doomedInserts = 0;

    /** The account the competing flow committed while ours was rolling back. */
    private ?User $racer = null;

    /**
     * Refuse the next $times link inserts exactly as the driver refuses one whose
     * subject a competing flow inserted first.
     *
     * The race cannot be staged for real in this suite: there is a single sqlite
     * :memory: connection, so there is no second connection to commit a competing row
     * from, and a row written on ours would be rolled back with our own transaction.
     * The driver's half of the race is therefore played by a model listener at the exact
     * statement the driver would have failed. Nothing about the service is stubbed —
     * which account it returns and how many rows exist afterwards are entirely its own.
     */
    private function doomTheLinkInsert(int $times): void {
        $this->doomedInserts = $times;
        UserIdentity::creating([$this, 'refuseTheDoomedInsert']);
    }

    public function refuseTheDoomedInsert(): void {
        if ($this->doomedInserts <= 0) {
            return;
        }

        $this->doomedInserts--;

        throw new UniqueConstraintViolationException(
            'sqlite',
            'insert into "user_identities" ("user_id", "provider", "provider_user_id") values (?, ?, ?)',
            [],
            new PDOException('UNIQUE constraint failed: user_identities.provider, user_identities.provider_user_id'),
        );
    }

    /**
     * The other half of the race: the competing flow commits its account and link at the
     * one moment our transaction is no longer holding the rows — as it rolls back.
     */
    private function letARacerWin(): void {
        Event::listen(TransactionRolledBack::class, [$this, 'commitTheRacer']);
    }

    public function commitTheRacer(): void {
        if ($this->racer !== null) {
            return;
        }

        $this->racer = User::factory()->googleOnly()->create(['email' => 'visitor@example.com']);
        UserIdentity::factory()->for($this->racer)->create(['provider_user_id' => self::SUB]);
    }

    public function test_a_lost_insert_race_resolves_to_the_account_the_winner_created(): void {
        $this->doomTheLinkInsert(1);
        $this->letARacerWin();

        $user = $this->service()->resolve($this->identity());

        // The re-run finds the link the winner committed and takes the returning-visitor
        // path, so the loser of the race signs INTO the account rather than beside it.
        $this->assertNotNull($this->racer);
        $this->assertSame($this->racer->id, $user->id);
    }

    public function test_a_lost_insert_race_leaves_exactly_one_account_and_one_link(): void {
        $this->doomTheLinkInsert(1);
        $this->letARacerWin();

        $this->service()->resolve($this->identity());

        // US4 AS5: at most one account, at most one session — the half-built account the
        // first attempt created went back with its transaction.
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
        $this->assertSame(self::SUB, UserIdentity::sole()->provider_user_id);
    }

    public function test_the_re_resolution_is_attempted_exactly_once(): void {
        $this->doomTheLinkInsert(2);

        try {
            $this->service()->resolve($this->identity());
            $this->fail('Expected a second constraint violation to be reported rather than retried.');
        }
        catch (UniqueConstraintViolationException) {
            // A second violation is not a lost race any more; it is a genuine fault, and
            // retrying it forever would turn one bad row into a hung request.
            $this->assertSame(0, $this->doomedInserts);
        }

        // Both attempts rolled back whole, so a refused sign-in leaves nothing behind.
        $this->assertSame(0, User::count());
        $this->assertSame(0, UserIdentity::count());
    }
}
