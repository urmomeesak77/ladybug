<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\RatingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The whole rating adjustment table from data-model.md, method by method. Every delta is
 * conditional on a per-meme flag actually changing — that single rule is what delivers
 * "no drift across activate/deactivate cycles" (FR-006), "at most one deletion penalty
 * per meme" (FR-008), and sequential idempotency (FR-014). The tests below therefore
 * always assert the flag alongside the number.
 */
final class RatingServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): RatingService {
        return new RatingService();
    }

    /**
     * A post owned by a fresh account at the given rating. The rating is assigned, not
     * mass-assigned: it is deliberately absent from User::$fillable (FR-003).
     */
    private function ownedPost(int $rating = 0, array $postState = []): Trashpost {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return Trashpost::factory()->create(['user_id' => $user->id] + $postState);
    }

    public function test_credit_adds_one_and_sets_the_flag(): void {
        $post = $this->ownedPost();

        $this->service()->credit($post);

        $this->assertSame(1, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_credited);
    }

    public function test_credit_on_an_already_credited_meme_moves_nothing(): void {
        $post = $this->ownedPost(0, ['rating_credited' => true]);
        $post->user->fresh();

        $this->service()->credit($post);

        $this->assertSame(0, $post->user->fresh()->rating);
    }

    public function test_release_credit_subtracts_one_when_credited(): void {
        $post = $this->ownedPost(5, ['rating_credited' => true]);

        $this->service()->releaseCredit($post);

        $this->assertSame(4, $post->user->fresh()->rating);
        $this->assertFalse($post->fresh()->rating_credited);
    }

    public function test_release_credit_moves_nothing_on_a_meme_that_was_never_activated(): void {
        // Nothing was ever paid out for this meme and it was never live, so there is
        // nothing to release. Contrast the legacy case at the bottom of this file.
        $post = $this->ownedPost(5, ['activated_at' => null]);

        $this->service()->releaseCredit($post);

        $this->assertSame(5, $post->user->fresh()->rating);
    }

    public function test_penalize_subtracts_one_and_sets_the_flag(): void {
        $post = $this->ownedPost(5);

        $this->service()->penalize($post);

        $this->assertSame(4, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_penalized);
    }

    public function test_penalize_on_an_already_penalized_meme_moves_nothing(): void {
        $post = $this->ownedPost(5, ['rating_penalized' => true]);

        $this->service()->penalize($post);

        $this->assertSame(5, $post->user->fresh()->rating);
    }

    public function test_refund_adds_one_and_leaves_the_meme_penalizable_again(): void {
        $post = $this->ownedPost(5, ['rating_penalized' => true]);

        $this->service()->refund($post);

        $this->assertSame(6, $post->user->fresh()->rating);
        $this->assertFalse($post->fresh()->rating_penalized);

        // FR-010: a restored meme can cost its owner again if it is deleted a second time.
        $this->service()->penalize($post);
        $this->assertSame(5, $post->user->fresh()->rating);
    }

    public function test_refund_moves_nothing_when_not_penalized(): void {
        $post = $this->ownedPost(5);

        $this->service()->refund($post);

        $this->assertSame(5, $post->user->fresh()->rating);
    }

    public function test_settle_purge_of_a_live_activated_meme_costs_two(): void {
        // US1 §9: purging a credited, unpenalized meme releases the credit AND applies the
        // one deletion penalty — both in a single call.
        $post = $this->ownedPost(5, ['rating_credited' => true]);

        $this->service()->settlePurge($post);

        $this->assertSame(3, $post->user->fresh()->rating);
    }

    public function test_settle_purge_of_an_already_penalized_meme_costs_one(): void {
        $post = $this->ownedPost(5, ['rating_credited' => true, 'rating_penalized' => true]);

        $this->service()->settlePurge($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_every_method_succeeds_on_an_unowned_meme_and_adjusts_nothing(): void {
        // FR-012: a meme whose account is gone still books its flags, but there is nobody
        // to charge. None of the five methods may error.
        $post = Trashpost::factory()->create(['user_id' => null]);

        $this->service()->credit($post);
        $this->assertTrue($post->fresh()->rating_credited);

        $this->service()->releaseCredit($post);
        $this->assertFalse($post->fresh()->rating_credited);

        $this->service()->penalize($post);
        $this->assertTrue($post->fresh()->rating_penalized);

        $this->service()->refund($post);
        $this->assertFalse($post->fresh()->rating_penalized);

        $this->service()->settlePurge($post);
        $this->assertTrue($post->fresh()->rating_penalized);
    }

    public function test_credit_saturates_at_the_upper_bound(): void {
        // FR-011a: the adjustment is silently dropped and the call still succeeds — the
        // moderation action it belongs to must not fail because a rating maxed out.
        $post = $this->ownedPost(RatingService::MAX);

        $this->service()->credit($post);

        $this->assertSame(RatingService::MAX, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_credited);
    }

    public function test_penalize_saturates_at_the_lower_bound(): void {
        $post = $this->ownedPost(RatingService::MIN);

        $this->service()->penalize($post);

        $this->assertSame(RatingService::MIN, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_penalized);
    }

    public function test_a_legacy_activated_meme_still_costs_one_on_release(): void {
        // FR-002 / SC-005: memes activated before this feature carry no credit, so
        // deactivating them takes the normal −1 with no matching +1 ever granted. The
        // spec accepts this baseline explicitly, which is why releaseCredit charges on
        // "was live" rather than on the credit flag alone.
        $post = $this->ownedPost(5, ['activated_at' => now(), 'rating_credited' => false]);

        $this->service()->releaseCredit($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_releasing_a_legacy_memes_credit_twice_only_costs_one(): void {
        // The legacy carve-out must not break idempotency: the second release sees a
        // meme that is no longer live and charges nothing (SC-005's −2..0 bound).
        $post = $this->ownedPost(5, ['activated_at' => now(), 'rating_credited' => false]);

        $this->service()->releaseCredit($post);
        $post->activated_at = null;
        $post->save();
        $this->service()->releaseCredit($post);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_settle_purge_of_a_legacy_activated_meme_costs_two(): void {
        // SC-005's lower bound for a pre-feature meme: no credit was ever granted, yet
        // purging still releases the activation and applies the deletion penalty.
        $post = $this->ownedPost(5, ['activated_at' => now(), 'rating_credited' => false]);

        $this->service()->settlePurge($post);

        $this->assertSame(3, $post->user->fresh()->rating);
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
}
