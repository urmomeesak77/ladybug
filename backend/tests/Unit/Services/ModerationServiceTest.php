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
}
