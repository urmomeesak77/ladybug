<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\SitemapService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The address listing a crawler walks: which memes are in it, in what order, and
 * how it splits once one file would hold too many.
 *
 * Membership here is the same Trashpost::publiclyVisible() scope the feed uses, so
 * these cases are also the guard against the archive a crawler is offered drifting
 * away from the archive a visitor can browse (FR-017).
 */
final class SitemapServiceTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.sitemap_chunk' => 50000,
            'seo.cache_ttl' => 3600,
        ]);
    }

    private function service(): SitemapService {
        return new SitemapService();
    }

    public function test_the_index_lists_the_static_child_and_one_post_child(): void {
        Trashpost::factory()->visible()->create();

        $xml = $this->service()->index();

        $this->assertStringContainsString('<sitemapindex', $xml);
        $this->assertStringContainsString('<loc>https://online-trash.com/sitemaps/static.xml</loc>', $xml);
        $this->assertStringContainsString('<loc>https://online-trash.com/sitemaps/posts-1.xml</loc>', $xml);
        $this->assertStringNotContainsString('posts-2.xml', $xml);
    }

    /** Spec edge case "Empty site": the index stays well-formed with no memes at all. */
    public function test_the_index_stays_valid_with_no_visible_memes(): void {
        Trashpost::factory()->hidden()->create();

        $xml = $this->service()->index();

        $this->assertStringContainsString('<loc>https://online-trash.com/sitemaps/static.xml</loc>', $xml);
        $this->assertStringNotContainsString('posts-1.xml', $xml);
        $this->assertSame(1, substr_count($xml, '<sitemap>'));
    }

    public function test_the_static_child_lists_the_indexable_static_addresses(): void {
        $xml = $this->service()->staticUrls();

        $this->assertStringContainsString('<urlset', $xml);
        $this->assertStringContainsString('<loc>https://online-trash.com/</loc>', $xml);
        // Every other static address is behind a login or a signed link (FR-012).
        $this->assertStringNotContainsString('/login', $xml);
        $this->assertStringNotContainsString('/admin', $xml);
    }

    /** The static child is cached under the key the contract fixes, like its siblings. */
    public function test_the_static_child_is_served_from_the_cache_when_it_is_warm(): void {
        Cache::put('seo:sitemap:v1:static', '<urlset>cached</urlset>', 3600);

        $this->assertSame('<urlset>cached</urlset>', $this->service()->staticUrls());
    }

    public function test_a_post_page_lists_permalinks_newest_first_with_their_publication_date(): void {
        $older = Trashpost::factory()->visible()->create(['created_at' => '2026-07-14 09:31:02']);
        $newer = Trashpost::factory()->visible()->create(['created_at' => '2026-07-20 11:00:00']);

        $xml = (string) $this->service()->postsPage(1);

        $this->assertStringContainsString("<loc>https://online-trash.com/posts/{$older->hash}</loc>", $xml);
        $this->assertStringContainsString("<loc>https://online-trash.com/posts/{$newer->hash}</loc>", $xml);
        $this->assertLessThan(
            strpos($xml, $older->hash),
            strpos($xml, $newer->hash),
            'The newest meme must sit at the head of the first child sitemap.',
        );
        $this->assertStringContainsString('<lastmod>' . $newer->created_at->toAtomString() . '</lastmod>', $xml);
    }

    /** The major engines ignore both, and a wrong value is worse than none. */
    public function test_a_post_page_omits_changefreq_and_priority(): void {
        Trashpost::factory()->visible()->create();

        $xml = (string) $this->service()->postsPage(1);

        $this->assertStringNotContainsString('changefreq', $xml);
        $this->assertStringNotContainsString('priority', $xml);
    }

    /** FR-017: the listing may never advertise a meme the public API hides. */
    public function test_pending_and_soft_deleted_memes_never_appear(): void {
        $visible = Trashpost::factory()->visible()->create();
        $pending = Trashpost::factory()->hidden()->create();
        $deleted = Trashpost::factory()->deleted()->create();

        $xml = (string) $this->service()->postsPage(1);

        $this->assertStringContainsString($visible->hash, $xml);
        $this->assertStringNotContainsString($pending->hash, $xml);
        $this->assertStringNotContainsString($deleted->hash, $xml);
    }

    public function test_a_page_beyond_the_last_one_yields_nothing(): void {
        Trashpost::factory()->visible()->create();

        $this->assertNull($this->service()->postsPage(2));
    }

    public function test_a_page_below_one_yields_nothing(): void {
        Trashpost::factory()->visible()->create();

        $this->assertNull($this->service()->postsPage(0));
        $this->assertNull($this->service()->postsPage(-1));
    }

    /** AS2.6 / FR-020: the rendered XML is cached, so a repeat costs no query. */
    public function test_a_second_render_inside_the_ttl_performs_no_query(): void {
        Trashpost::factory()->visible()->create();
        $service = $this->service();
        $service->index();
        $service->postsPage(1);

        DB::enableQueryLog();
        $index = $service->index();
        $page = (string) $service->postsPage(1);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame([], $queries);
        $this->assertStringContainsString('posts-1.xml', $index);
        $this->assertStringContainsString('<urlset', $page);
    }

    /**
     * FR-019 / AS2.3, with the chunk shrunk to 2: at the production chunk of 50,000
     * the keyset hand-off between two children is never executed by any realistic
     * fixture, so this is the only case that runs the walk's riskiest line.
     */
    public function test_the_listing_splits_into_linked_children_past_the_chunk(): void {
        config(['seo.sitemap_chunk' => 2]);
        Trashpost::factory()->visible()->count(3)->create();

        $index = $this->service()->index();

        $this->assertStringContainsString('<loc>https://online-trash.com/sitemaps/posts-1.xml</loc>', $index);
        $this->assertStringContainsString('<loc>https://online-trash.com/sitemaps/posts-2.xml</loc>', $index);
        $this->assertStringNotContainsString('posts-3.xml', $index);
    }

    public function test_the_children_partition_the_visible_memes_with_no_overlap_or_gap(): void {
        config(['seo.sitemap_chunk' => 2]);
        $posts = Trashpost::factory()->visible()->count(3)->create();
        $service = $this->service();

        $first = (string) $service->postsPage(1);
        $second = (string) $service->postsPage(2);

        $this->assertSame(2, substr_count($first, '<loc>'));
        $this->assertSame(1, substr_count($second, '<loc>'));
        foreach ($posts as $post) {
            $appearances = substr_count($first, $post->hash) + substr_count($second, $post->hash);
            $this->assertSame(1, $appearances, "The meme {$post->hash} must appear in exactly one child.");
        }
        $this->assertNull($service->postsPage(3));
    }
}
