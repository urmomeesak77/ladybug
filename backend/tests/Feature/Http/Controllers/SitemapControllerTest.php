<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The three sitemap addresses as a crawler retrieves them.
 *
 * The shell catch-all matches every path that is not an API route, so the one
 * thing these cases must prove beyond the body is that it does not win here
 * (FR-022) — hence the fixture shell, which makes an interception show up as a
 * served document rather than as a missing-template error.
 */
final class SitemapControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.sitemap_chunk' => 50000,
            'seo.cache_ttl' => 3600,
            'seo.shell_path' => base_path('tests/fixtures/spa-shell.html'),
        ]);
    }

    public function test_the_index_is_served_as_cacheable_xml(): void {
        Trashpost::factory()->visible()->create();

        $response = $this->get('/sitemap.xml');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        // Public and hour-long: the listing is identical for every requester, and
        // FR-020 makes the refresh interval the contract (AS2.5).
        $response->assertHeader('Cache-Control', 'max-age=3600, public');
        $response->assertSee('<sitemapindex', escape: false);
    }

    public function test_the_static_child_is_served_as_xml(): void {
        $response = $this->get('/sitemaps/static.xml');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $response->assertSee('<loc>https://online-trash.com/</loc>', escape: false);
    }

    public function test_a_post_child_is_served_as_xml(): void {
        $post = Trashpost::factory()->visible()->create();

        $response = $this->get('/sitemaps/posts-1.xml');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $response->assertHeader('Cache-Control', 'max-age=3600, public');
        $response->assertSee("<loc>https://online-trash.com/posts/{$post->hash}</loc>", escape: false);
    }

    public function test_an_out_of_range_post_child_is_not_found(): void {
        Trashpost::factory()->visible()->create();

        $this->get('/sitemaps/posts-99.xml')->assertNotFound();
    }

    public function test_a_non_numeric_post_child_is_not_found(): void {
        $this->get('/sitemaps/posts-abc.xml')->assertNotFound();
    }

    /** FR-022: registered above the shell catch-all, so the SPA never swallows them. */
    public function test_the_sitemap_addresses_are_not_intercepted_by_the_shell(): void {
        Trashpost::factory()->visible()->create();

        foreach (['/sitemap.xml', '/sitemaps/static.xml', '/sitemaps/posts-1.xml'] as $path) {
            $response = $this->get($path);

            $response->assertOk();
            $response->assertDontSee('<div id="root">', escape: false);
        }
    }
}
