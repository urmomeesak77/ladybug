<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Support\SpaRoutes;
use Tests\TestCase;

/**
 * The crawler instruction file.
 *
 * The content type is the case that matters most: today this address answers with
 * the SPA shell as text/html, which no crawler reads as robots.txt at all. Asserting
 * text/plain is the regression guard against sliding back into that.
 */
final class RobotsControllerTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.shell_path' => base_path('tests/fixtures/spa-shell.html'),
        ]);
    }

    public function test_robots_is_served_as_plain_text(): void {
        $response = $this->get('/robots.txt');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
        $response->assertHeader('Cache-Control', 'max-age=3600, public');
        $response->assertDontSee('<div id="root">', escape: false);
    }

    public function test_robots_disallows_exactly_the_private_areas(): void {
        $body = $this->get('/robots.txt')->getContent();

        $this->assertIsString($body);
        $this->assertStringContainsString('User-agent: *', $body);
        foreach (SpaRoutes::disallowedPaths() as $path) {
            $this->assertStringContainsString("Disallow: {$path}\n", $body);
        }
        $this->assertSame(count(SpaRoutes::disallowedPaths()), substr_count($body, 'Disallow:'));
    }

    /** FR-023: image crawlers must keep reaching meme media, and rendering crawlers the bundle. */
    public function test_media_and_asset_paths_are_not_disallowed(): void {
        $body = (string) $this->get('/robots.txt')->getContent();

        $this->assertStringNotContainsString('/storage/', $body);
        $this->assertStringNotContainsString('/assets/', $body);
    }

    /** Absolutised from APP_URL, so dev and e2e never point crawlers at production. */
    public function test_robots_names_the_sitemap_on_this_origin(): void {
        $body = (string) $this->get('/robots.txt')->getContent();

        $this->assertStringContainsString('Sitemap: https://online-trash.com/sitemap.xml', $body);
    }
}
