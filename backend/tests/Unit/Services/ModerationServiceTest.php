<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\MediaVisibilityService;
use App\Services\ModerationService;
use App\Services\RatingService;
use App\Support\MediaPath;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

/**
 * A RatingService whose adjustment always fails, used to prove that a moderation
 * transition rolls its state change back when the rating half throws (FR-013).
 */
final class ThrowingRatingService extends RatingService {
    public function credit(Trashpost $post): void {
        throw new RuntimeException('rating write failed');
    }

    public function releaseCredit(Trashpost $post): void {
        throw new RuntimeException('rating write failed');
    }

    public function penalize(Trashpost $post): void {
        throw new RuntimeException('rating write failed');
    }

    public function refund(Trashpost $post): void {
        throw new RuntimeException('rating write failed');
    }

    public function settlePurge(Trashpost $post): void {
        throw new RuntimeException('rating write failed');
    }
}

/**
 * The moderation index query: every meme in every state (withTrashed, no activation
 * filter), newest-first by created_at then id, 100 per page. Out-of-range pages and an
 * empty corpus are valid (empty data, sane meta), not errors.
 */
final class ModerationServiceTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Every state transition now syncs media, so most tests here do storage
        // I/O — fake both disks up front so no test can ever touch the real
        // bind-mounted media tree.
        Storage::fake('public');
        Storage::fake('local');
    }

    private function service(): ModerationService {
        return new ModerationService();
    }

    public function test_paginates_at_one_hundred_per_page(): void {
        Trashpost::factory()->count(101)->create();

        $page = $this->service()->paginate(1);

        $this->assertSame(100, $page->perPage());
        $this->assertCount(100, $page->items());
        $this->assertSame(101, $page->total());
        $this->assertSame(2, $page->lastPage());
    }

    public function test_includes_soft_deleted_and_unactivated_rows(): void {
        $live = Trashpost::factory()->create(['activated_at' => now(), 'deleted_at' => null]);
        $hidden = Trashpost::factory()->hidden()->create();
        $deleted = Trashpost::factory()->deleted()->create();

        $hashes = collect($this->service()->paginate(1)->items())->pluck('hash')->all();

        $this->assertContains($live->hash, $hashes);
        $this->assertContains($hidden->hash, $hashes);
        $this->assertContains($deleted->hash, $hashes);
    }

    public function test_orders_newest_first_by_created_at_then_id(): void {
        $older = Trashpost::factory()->create(['created_at' => now()->subDay()]);
        $newer = Trashpost::factory()->create(['created_at' => now()]);
        // Same instant, larger id must sort ahead of smaller id (id DESC tiebreak).
        $sameA = Trashpost::factory()->create(['created_at' => now()->subHour()]);
        $sameB = Trashpost::factory()->create(['created_at' => now()->subHour()]);

        $items = collect($this->service()->paginate(1)->items())->pluck('hash')->all();

        $this->assertSame($newer->hash, $items[0]);
        $this->assertSame(
            array_search($sameB->hash, $items, true) < array_search($sameA->hash, $items, true),
            $sameB->id > $sameA->id,
        );
        $this->assertSame($older->hash, $items[count($items) - 1]);
    }

    public function test_out_of_range_page_returns_empty_data_with_valid_meta(): void {
        Trashpost::factory()->count(3)->create();

        $page = $this->service()->paginate(5);

        $this->assertCount(0, $page->items());
        $this->assertSame(3, $page->total());
        $this->assertSame(5, $page->currentPage());
    }

    public function test_empty_corpus_reports_a_zero_total(): void {
        $page = $this->service()->paginate(1);

        $this->assertCount(0, $page->items());
        $this->assertSame(0, $page->total());
    }

    public function test_activate_sets_activated_at_on_an_inactive_meme(): void {
        $post = Trashpost::factory()->hidden()->create();

        $updated = $this->service()->activate($post->hash);

        $this->assertNotNull($updated->activated_at);
    }

    public function test_deactivate_clears_activated_at(): void {
        $post = Trashpost::factory()->create(['activated_at' => now()]);

        $updated = $this->service()->deactivate($post->hash);

        $this->assertNull($updated->activated_at);
    }

    public function test_activate_is_idempotent_and_preserves_the_original_timestamp(): void {
        // Set-to-target, not overwrite: activating an already-activated meme keeps its
        // original activation instant (contract: "if not already activated"). Compare
        // against the stored value so DB datetime precision doesn't confound the check.
        $post = Trashpost::factory()->create(['activated_at' => now()->subDay()]);
        $original = $post->fresh()->activated_at;

        $updated = $this->service()->activate($post->hash);

        $this->assertTrue($updated->activated_at->equalTo($original));
    }

    public function test_deactivate_is_idempotent_on_an_already_inactive_meme(): void {
        $post = Trashpost::factory()->hidden()->create();

        $updated = $this->service()->deactivate($post->hash);

        $this->assertNull($updated->activated_at);
    }

    public function test_activation_transitions_find_a_soft_deleted_meme(): void {
        // withTrashed lookup: a soft-deleted meme is still reachable for activation changes.
        $post = Trashpost::factory()->deleted()->hidden()->create();

        $updated = $this->service()->activate($post->hash);

        $this->assertNotNull($updated->activated_at);
    }

    public function test_delete_soft_deletes_and_retains_the_row(): void {
        $post = Trashpost::factory()->create();

        $updated = $this->service()->delete($post->hash);

        $this->assertNotNull($updated->deleted_at);
        // Retained, not purged: still present when trashed rows are included.
        $this->assertTrue(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_restore_clears_deleted_at(): void {
        $post = Trashpost::factory()->deleted()->create();

        $updated = $this->service()->restore($post->hash);

        $this->assertNull($updated->deleted_at);
    }

    public function test_delete_is_idempotent_and_preserves_the_original_timestamp(): void {
        // Set-to-target: deleting an already-deleted meme keeps its original deleted_at.
        $post = Trashpost::factory()->deleted()->create();
        $original = $post->fresh()->deleted_at;

        $updated = $this->service()->delete($post->hash);

        $this->assertNotNull($updated->deleted_at);
        $this->assertTrue($updated->deleted_at->equalTo($original));
    }

    public function test_restore_is_idempotent_on_a_live_meme(): void {
        $post = Trashpost::factory()->create();

        $updated = $this->service()->restore($post->hash);

        $this->assertNull($updated->deleted_at);
    }

    public function test_restore_finds_a_soft_deleted_meme(): void {
        // The target to restore is itself soft-deleted; the withTrashed lookup still finds it.
        $post = Trashpost::factory()->deleted()->create();

        $this->service()->restore($post->hash);

        $this->assertNull($post->fresh()->deleted_at);
    }

    public function test_purge_removes_the_row_entirely(): void {
        $post = Trashpost::factory()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_deletes_every_image_size_variant(): void {
        $post = Trashpost::factory()->create();
        $paths = $this->seedImageVariants($post);

        $this->service()->purge($post->hash);

        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
        }
    }

    public function test_purge_leaves_another_posts_files_alone(): void {
        $post = Trashpost::factory()->create();
        $other = Trashpost::factory()->create();
        $otherPaths = $this->seedImageVariants($other);

        $this->service()->purge($post->hash);

        foreach ($otherPaths as $path) {
            Storage::disk('public')->assertExists($path);
        }
    }

    public function test_purge_works_on_a_soft_deleted_post(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_succeeds_when_the_files_are_already_missing(): void {
        // No variants were ever seeded on the fake disk; the purge must still remove the row.
        $post = Trashpost::factory()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_deletes_a_last_reference_youtube_thumbnail(): void {
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertMissing($thumbnail);
    }

    public function test_purge_keeps_a_youtube_thumbnail_shared_with_another_post(): void {
        // Thumbnails are stored once per video id; another post embedding the same video
        // must keep its image when this one is purged.
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);
        Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertExists($thumbnail);
    }

    public function test_purge_keeps_a_thumbnail_referenced_by_a_soft_deleted_post(): void {
        // "Referenced" includes trashed rows — a soft-deleted post may be restored later.
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);
        Trashpost::factory()->linkOnly()->deleted()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertExists($thumbnail);
    }

    public function test_purge_of_an_unknown_hash_throws_model_not_found(): void {
        $this->expectException(ModelNotFoundException::class);

        $this->service()->purge('Nonexist99');
    }

    public function test_delete_moves_the_memes_media_off_the_public_disk(): void {
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->delete($post->hash);

        Storage::disk('public')->assertMissing($path);
        Storage::disk('local')->assertExists($path);
    }

    public function test_restore_moves_the_memes_media_back_to_the_public_disk(): void {
        $post = Trashpost::factory()->deleted()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->restore($post->hash);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertExists($path);
    }

    public function test_deactivate_hides_media_and_activate_re_exposes_it(): void {
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->deactivate($post->hash);
        Storage::disk('public')->assertMissing($path);
        Storage::disk('local')->assertExists($path);

        $this->service()->activate($post->hash);
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }

    public function test_purge_removes_files_from_both_disks(): void {
        $post = Trashpost::factory()->deleted()->create([
            'file' => 'abc.jpg', 'type' => 'image',
        ]);
        // A soft-deleted meme's files live on the private disk by now.
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->purge($post->hash);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertMissing($path);
        $this->assertDatabaseMissing('trashposts', ['hash' => $post->hash]);
    }

    public function test_activate_credits_the_owner(): void {
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);

        $this->assertSame(1, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_credited);
    }

    public function test_deactivate_releases_the_owners_credit(): void {
        $post = $this->ownedPost(5, ['rating_credited' => true]);

        $this->service()->deactivate($post->hash);

        $this->assertSame(4, $post->user->fresh()->rating);
    }

    public function test_delete_penalizes_the_owner(): void {
        $post = $this->ownedPost(5);

        $this->service()->delete($post->hash);

        $this->assertSame(4, $post->user->fresh()->rating);
        $this->assertTrue($post->fresh()->rating_penalized);
    }

    public function test_restore_refunds_the_owners_penalty(): void {
        $post = $this->ownedPost(5, ['deleted_at' => now(), 'rating_penalized' => true]);

        $this->service()->restore($post->hash);

        $this->assertSame(6, $post->user->fresh()->rating);
    }

    public function test_purge_settles_the_rating_before_the_row_is_destroyed(): void {
        // A live, credited meme costs −2 in one operation (US1 §9). This assertion is
        // also the ordering proof: settle after forceDelete would find no row and
        // silently adjust nothing.
        $post = $this->ownedPost(5, ['rating_credited' => true]);
        $user = $post->user;

        $this->service()->purge($post->hash);

        $this->assertSame(3, $user->fresh()->rating);
    }

    public function test_moderation_on_an_unowned_meme_succeeds_without_a_rating(): void {
        // FR-012: the action must not error just because nobody can be charged.
        $post = Trashpost::factory()->hidden()->create(['user_id' => null]);

        $updated = $this->service()->activate($post->hash);

        $this->assertNotNull($updated->activated_at);
        $this->assertTrue($post->fresh()->rating_credited);
    }

    public function test_a_failed_rating_write_rolls_back_the_state_change(): void {
        // FR-013: the state change and its rating adjustment commit together. Forcing
        // the rating half to throw must leave the meme exactly as it was.
        $post = $this->ownedPost(0, ['activated_at' => null]);
        $service = new ModerationService(new MediaVisibilityService(), new ThrowingRatingService());

        try {
            $service->activate($post->hash);
            $this->fail('activate should have surfaced the rating failure');
        }
        catch (RuntimeException) {
            // expected
        }

        $this->assertNull($post->fresh()->activated_at);
        $this->assertSame(0, $post->user->fresh()->rating);
    }

    public function test_a_failed_rating_write_rolls_back_a_deactivate(): void {
        $post = $this->ownedPost(5, ['rating_credited' => true]);

        $this->assertRatingFailureRollsBack('deactivate', $post);

        $this->assertNotNull($post->fresh()->activated_at);
    }

    public function test_a_failed_rating_write_rolls_back_a_delete(): void {
        $post = $this->ownedPost(5);

        $this->assertRatingFailureRollsBack('delete', $post);

        $this->assertNull($post->fresh()->deleted_at);
    }

    public function test_a_failed_rating_write_rolls_back_a_restore(): void {
        $post = $this->ownedPost(5, ['deleted_at' => now()]);

        $this->assertRatingFailureRollsBack('restore', $post);

        $this->assertNotNull(Trashpost::withTrashed()->whereKey($post->id)->firstOrFail()->deleted_at);
    }

    public function test_a_failed_rating_write_rolls_back_a_purge(): void {
        // The strongest of the five: a lost rating settlement must not take the row
        // with it, or the meme is gone and the owner was never charged (FR-013).
        $post = $this->ownedPost(5, ['rating_credited' => true]);

        $this->assertRatingFailureRollsBack('purge', $post);

        $this->assertTrue(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    /**
     * Drive one transition with a RatingService that always throws, and assert the
     * failure surfaced and the owner's rating did not move. The caller then asserts
     * that the transition's own state change rolled back too.
     */
    private function assertRatingFailureRollsBack(string $transition, Trashpost $post): void {
        $service = new ModerationService(new MediaVisibilityService(), new ThrowingRatingService());
        $before = $post->user->fresh()->rating;

        try {
            $service->{$transition}($post->hash);
            $this->fail("{$transition} should have surfaced the rating failure");
        }
        catch (RuntimeException) {
            // expected
        }

        $this->assertSame($before, $post->user->fresh()->rating);
    }

    public function test_activate_deactivate_purge_nets_minus_one(): void {
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);
        $this->service()->deactivate($post->hash);
        $this->service()->purge($post->hash);

        $this->assertSame(-1, $post->user->fresh()->rating);
    }

    public function test_activate_soft_delete_purge_nets_minus_one(): void {
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);
        $this->service()->delete($post->hash);
        $this->service()->purge($post->hash);

        $this->assertSame(-1, $post->user->fresh()->rating);
    }

    public function test_activate_then_purge_nets_minus_one(): void {
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);
        $this->service()->purge($post->hash);

        $this->assertSame(-1, $post->user->fresh()->rating);
    }

    public function test_activation_churn_cannot_farm_rating(): void {
        // FR-006: activate → deactivate → activate lands at +1, never +2.
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);
        $this->service()->deactivate($post->hash);
        $this->service()->activate($post->hash);

        $this->assertSame(1, $post->user->fresh()->rating);
    }

    public function test_soft_delete_then_restore_nets_zero(): void {
        $post = $this->ownedPost(0);

        $this->service()->delete($post->hash);
        $this->service()->restore($post->hash);

        $this->assertSame(0, $post->user->fresh()->rating);
    }

    public function test_repeated_activate_credits_only_once(): void {
        $post = $this->ownedPost(0, ['activated_at' => null]);

        $this->service()->activate($post->hash);
        $this->service()->activate($post->hash);

        $this->assertSame(1, $post->user->fresh()->rating);
    }

    /**
     * A post owned by a fresh account pinned to $rating. The rating is assigned rather
     * than mass-assigned — it is deliberately absent from User::$fillable (FR-003).
     *
     * @param array<string, mixed> $postState
     */
    private function ownedPost(int $rating = 0, array $postState = []): Trashpost {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return Trashpost::factory()->create(['user_id' => $user->id] + $postState);
    }

    /**
     * Put a stub file at every image-size variant path of the post's file.
     *
     * @return list<string> the seeded relative paths
     */
    private function seedImageVariants(Trashpost $post): array {
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $paths[] = $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->put($path, 'stub');
        }

        return $paths;
    }
}
