<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ShellControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            // Never the real build artifact: the suite must not depend on anyone
            // having run `vite build` (research D2).
            'seo.shell_path' => base_path('tests/fixtures/spa-shell.html'),
        ]);
    }

    private function fixture(): string {
        return (string) file_get_contents(base_path('tests/fixtures/spa-shell.html'));
    }

    public function test_the_home_feed_serves_the_shell_with_site_metadata(): void {
        $response = $this->get('/');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/html; charset=UTF-8');
        $response->assertSee('<title>online-trash</title>', escape: false);
        $response->assertSee('<link rel="canonical" href="https://online-trash.com/">', escape: false);
        $response->assertSee('<meta property="og:type" content="website">', escape: false);
    }

    /** FR-012: the home feed is the one indexable address, so it carries no robots tag. */
    public function test_the_home_feed_is_not_marked_noindex(): void {
        $this->get('/')->assertDontSee('name="robots"', escape: false);
    }

    public function test_an_account_address_is_marked_noindex(): void {
        $response = $this->get('/login');

        $response->assertOk();
        $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
        $response->assertSee('<link rel="canonical" href="https://online-trash.com/login">', escape: false);
    }

    /**
     * FR-009: the document below </head> is the built shell untouched, so nothing
     * about how the SPA boots or renders changes.
     */
    public function test_the_document_below_the_head_close_is_the_shell_untouched(): void {
        $fixture = $this->fixture();

        $body = $this->get('/')->getContent();

        $this->assertIsString($body);
        $this->assertSame(
            substr($fixture, (int) strpos($fixture, '</head>')),
            substr($body, (int) strpos($body, '</head>')),
        );
    }

    /** The shell is cheap to rebuild and must reflect a moderation action at once. */
    public function test_the_shell_is_not_cached_by_intermediaries(): void {
        $this->get('/')->assertHeader('Cache-Control', 'no-cache, private');
    }

    /**
     * The catch-all must not shadow the JSON API, the health probe or Sanctum.
     * Production nginx never routes those here, but PHPUnit calls the app with no
     * nginx in front, so the guard has to live in the route constraint.
     */
    public function test_the_catch_all_does_not_shadow_the_api(): void {
        $response = $this->getJson('/api/posts');

        $response->assertOk();
        $this->assertStringNotContainsString('<div id="root">', (string) $response->getContent());
    }

    public function test_the_catch_all_does_not_shadow_the_health_probe(): void {
        $response = $this->get('/up');

        $response->assertOk();
        $this->assertStringNotContainsString('<div id="root">', (string) $response->getContent());
    }

    public function test_the_catch_all_does_not_shadow_sanctum(): void {
        $response = $this->get('/sanctum/csrf-cookie');

        $response->assertNoContent();
    }

    /**
     * The exclusion matches a whole path segment, not a prefix: `/uptime`,
     * `/apixyz` and `/storage-wars` are ordinary unknown addresses and must answer
     * with the site's own not-found view (FR-014), never the framework's error page.
     */
    public function test_addresses_that_merely_start_like_an_excluded_prefix_reach_the_shell(): void {
        foreach (['/uptime', '/apixyz', '/storage-wars'] as $path) {
            $response = $this->get($path);

            $response->assertNotFound();
            $this->assertStringContainsString('<div id="root">', (string) $response->getContent(), $path);
        }
    }

    /** FR-013/FR-014: an unknown address is a real 404 carrying the same shell. */
    public function test_an_unknown_address_is_a_not_found_carrying_the_shell(): void {
        $response = $this->get('/nope');

        $response->assertNotFound();
        $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
        $this->assertStringContainsString('<div id="root">', (string) $response->getContent());
    }
}
