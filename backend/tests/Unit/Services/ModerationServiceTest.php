<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\ModerationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The moderation index query: every meme in every state (withTrashed, no activation
 * filter), newest-first by created_at then id, 100 per page. Out-of-range pages and an
 * empty corpus are valid (empty data, sane meta), not errors.
 */
final class ModerationServiceTest extends TestCase {
    use RefreshDatabase;

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
}
