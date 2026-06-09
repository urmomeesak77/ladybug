<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\TrashpostService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class TrashpostServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): TrashpostService {
        return new TrashpostService();
    }

    public function test_feed_returns_visible_posts_newest_first_by_activated_at(): void {
        $older = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);
        $newer = Trashpost::factory()->visible()->create(['activated_at' => now()]);

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$newer->id, $older->id], $ids);
    }

    public function test_feed_breaks_activated_at_ties_by_id_descending(): void {
        $at = now();
        $first = Trashpost::factory()->visible()->create(['activated_at' => $at]);
        $second = Trashpost::factory()->visible()->create(['activated_at' => $at]);

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$second->id, $first->id], $ids);
    }

    public function test_feed_defaults_to_ten_posts_per_page(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed([]));
    }

    public function test_feed_honors_a_valid_limit(): void {
        Trashpost::factory()->count(6)->visible()->create();

        $this->assertCount(3, $this->service()->feed(['limit' => 3]));
    }

    public function test_feed_clamps_limit_to_a_maximum_of_fifty(): void {
        Trashpost::factory()->count(51)->visible()->create();

        $this->assertCount(50, $this->service()->feed(['limit' => 999]));
    }

    public function test_feed_falls_back_to_default_for_non_numeric_limit(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed(['limit' => 'abc']));
    }

    public function test_feed_falls_back_to_default_for_non_positive_limit(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed(['limit' => 0]));
        $this->assertCount(10, $this->service()->feed(['limit' => -5]));
    }

    public function test_feed_cursor_returns_only_strictly_older_posts(): void {
        $newest = Trashpost::factory()->visible()->create(['activated_at' => now()]);
        $cursor = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);
        $older = Trashpost::factory()->visible()->create(['activated_at' => now()->subDays(2)]);

        $ids = $this->service()->feed(['start' => $cursor->hash])->pluck('id')->all();

        $this->assertSame([$older->id], $ids);
        $this->assertNotContains($newest->id, $ids);
        $this->assertNotContains($cursor->id, $ids);
    }

    public function test_feed_ignores_an_unknown_start_cursor(): void {
        Trashpost::factory()->count(3)->visible()->create();

        $this->assertCount(3, $this->service()->feed(['start' => '__nomatch__']));
    }

    public function test_feed_cursor_includes_an_older_post_with_a_larger_id(): void {
        // Proves the keyset is the OR-form, not the flat
        // `activated_at < cursor AND id < cursor.id`: this post is activated
        // earlier than the cursor yet has a LARGER id (inserted later), so the
        // flat predicate would wrongly drop it.
        $cursor = Trashpost::factory()->visible()->create(['activated_at' => now()]);
        $olderButLargerId = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);

        $this->assertGreaterThan($cursor->id, $olderButLargerId->id);

        $ids = $this->service()->feed(['start' => $cursor->hash])->pluck('id')->all();

        $this->assertContains($olderButLargerId->id, $ids);
    }

    public function test_feed_excludes_hidden_and_soft_deleted_posts(): void {
        $visible = Trashpost::factory()->visible()->create();
        Trashpost::factory()->hidden()->create();
        Trashpost::factory()->deleted()->create();

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$visible->id], $ids);
    }

    public function test_feed_returns_an_empty_collection_when_no_posts_are_visible(): void {
        Trashpost::factory()->hidden()->create();

        $this->assertTrue($this->service()->feed([])->isEmpty());
    }

    public function test_find_visible_by_hash_returns_the_post_for_a_visible_hash(): void {
        $post = Trashpost::factory()->visible()->create();

        $found = $this->service()->findVisibleByHash($post->hash);

        $this->assertNotNull($found);
        $this->assertSame($post->id, $found->id);
    }

    public function test_find_visible_by_hash_returns_null_for_a_hidden_post(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->assertNull($this->service()->findVisibleByHash($post->hash));
    }

    public function test_find_visible_by_hash_returns_null_for_a_soft_deleted_post(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->assertNull($this->service()->findVisibleByHash($post->hash));
    }

    public function test_find_visible_by_hash_returns_null_for_an_unknown_hash(): void {
        $this->assertNull($this->service()->findVisibleByHash('__nomatch__'));
    }
}
