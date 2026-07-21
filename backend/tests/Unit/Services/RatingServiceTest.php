<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Enums\Role;
use App\Models\Trashpost;
use App\Models\User;
use App\Services\RatingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Each method moves the owner's rating by a fixed ±1 with no per-meme ledger: whether a
 * given transition should move the rating at all is the caller's decision (the state
 * guards in ModerationService), so these unit tests assert only the delta and the two
 * invariants every adjustment shares — a null owner is charged nothing, and the rating
 * saturates at the column's signed-smallint bounds.
 */
final class RatingServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): RatingService {
        return new RatingService();
    }

    /**
     * A post owned by a fresh account at the given rating. The rating is assigned, not
     * mass-assigned: it is deliberately absent from User::$fillable (FR-003).
     *
     * @param array<string, mixed> $postState
     */
    private function ownedPost(int $rating = 0, array $postState = []): Trashpost {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return Trashpost::factory()->create(['user_id' => $user->id] + $postState);
    }

    public function test_credit_adds_one_to_the_owner(): void {
        $post = $this->ownedPost();

        $this->service()->credit($post);

        $this->assertSame(1, $post->user->fresh()->rating);
    }

    public function test_release_credit_subtracts_one_from_the_owner(): void {
        $post = $this->ownedPost(5);

        $this->service()->releaseCredit($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_penalize_subtracts_one_from_the_owner(): void {
        $post = $this->ownedPost(5);

        $this->service()->penalize($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_refund_adds_one_to_the_owner(): void {
        $post = $this->ownedPost(5);

        $this->service()->refund($post);

        $this->assertSame(6, $post->user->fresh()->rating);
    }

    public function test_settle_purge_subtracts_one_from_the_owner(): void {
        // Purge is the one always-costs-−1 action, whatever the meme's state — the caller
        // does not guard it (design 2026-07-21).
        $post = $this->ownedPost(5);

        $this->service()->settlePurge($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_every_method_succeeds_on_an_unowned_meme_and_adjusts_nothing(): void {
        // FR-012: a meme whose account is gone has nobody to charge. None of the five
        // methods may error, and there is no rating to move.
        $post = Trashpost::factory()->create(['user_id' => null]);

        $this->service()->credit($post);
        $this->service()->releaseCredit($post);
        $this->service()->penalize($post);
        $this->service()->refund($post);
        $this->service()->settlePurge($post);

        $this->assertNull($post->fresh()->user_id);
    }

    public function test_credit_saturates_at_the_upper_bound(): void {
        // FR-011a: the adjustment is silently dropped and the call still succeeds — the
        // moderation action it belongs to must not fail because a rating maxed out.
        $post = $this->ownedPost(RatingService::MAX);

        $this->service()->credit($post);

        $this->assertSame(RatingService::MAX, $post->user->fresh()->rating);
    }

    public function test_penalize_saturates_at_the_lower_bound(): void {
        $post = $this->ownedPost(RatingService::MIN);

        $this->service()->penalize($post);

        $this->assertSame(RatingService::MIN, $post->user->fresh()->rating);
    }

    public function test_settle_purge_saturates_at_the_lower_bound(): void {
        $post = $this->ownedPost(RatingService::MIN);

        $this->service()->settlePurge($post);

        $this->assertSame(RatingService::MIN, $post->user->fresh()->rating);
    }

    /**
     * A member at the given rating. The rating is assigned, not mass-assigned (FR-003).
     */
    private function memberAt(int $rating): User {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return $user;
    }

    public function test_a_member_one_below_the_threshold_does_not_auto_activate(): void {
        // FR-016's boundary is inclusive at 15, so 14 is the last rating that waits.
        $this->assertFalse($this->service()->shouldAutoActivate($this->memberAt(14)));
    }

    public function test_a_member_at_the_threshold_auto_activates(): void {
        $this->assertTrue($this->service()->shouldAutoActivate($this->memberAt(RatingService::TRUST_THRESHOLD)));
    }

    public function test_a_member_above_the_threshold_auto_activates(): void {
        $this->assertTrue($this->service()->shouldAutoActivate($this->memberAt(40)));
    }

    public function test_the_threshold_is_read_before_the_new_uploads_own_credit(): void {
        // FR-020: the decision is made against the rating as it stands, never against
        // the rating the upload is about to earn — otherwise a member at 14 would
        // bootstrap themselves over the line with the credit of the very post being
        // judged, publishing one upload early.
        $member = $this->memberAt(14);

        $this->assertFalse($this->service()->shouldAutoActivate($member));
        $this->assertSame(14, $member->fresh()->rating);
    }

    /** An account at the given role and rating (rating assigned, not mass-assigned). */
    private function accountAt(Role $role, int $rating): User {
        $user = User::factory()->create(['role' => $role->value]);
        $user->rating = $rating;
        $user->save();

        return $user;
    }

    public function test_an_admin_auto_activates_at_a_rating_that_would_hold_a_member_back(): void {
        // FR-017: a moderator never queues behind their own queue. Rating 0 is where
        // every account starts, and it is well below the member threshold.
        $this->assertTrue($this->service()->shouldAutoActivate($this->accountAt(Role::Admin, 0)));
    }

    public function test_a_superuser_auto_activates_even_at_a_negative_rating(): void {
        $this->assertTrue($this->service()->shouldAutoActivate($this->accountAt(Role::Superuser, -5)));
    }

    // That the role branch WIDENS the predicate rather than replacing it is guarded by
    // test_a_member_one_below_the_threshold_does_not_auto_activate above: the factory's
    // default role is member, so a still-false result there means the rating half lives.
}
