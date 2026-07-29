<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\PageMetaService;
use App\Support\MediaPath;
use App\Support\PageMeta;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

final class ShellControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // No test may reach the real bind-mounted media tree.
        Storage::fake('public');
        config([
            'app.url' => 'https://online-trash.com',
            'seo.site_description' => 'An endless feed of memes.',
            // Never the real build artifact: the suite must not depend on anyone
            // having run `vite build` (research D2).
            'seo.shell_path' => base_path('tests/fixtures/spa-shell.html'),
        ]);
    }

    private function fixture(): string {
        return (string) file_get_contents(base_path('tests/fixtures/spa-shell.html'));
    }

    /**
     * Write the given image variants for a post to the faked public disk, so
     * TrashpostImageService::imageData() finds them exactly as it would in prod.
     *
     * @param  list<string>  $sizes
     */
    private function writeImageVariants(Trashpost $post, array $sizes): void {
        $code = pathinfo((string) $post->file, PATHINFO_FILENAME);
        $ext = pathinfo((string) $post->file, PATHINFO_EXTENSION);
        foreach ($sizes as $size) {
            Storage::disk('public')->put(MediaPath::imageRelativePath($size, $code, $ext), 'x');
        }
    }

    private function headOf(string $body): string {
        return substr($body, 0, (int) strpos($body, '</head>'));
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

    /** AS1.1: the meme's own title, description and canonical, with no JS in the loop. */
    public function test_a_meme_permalink_carries_its_own_title_and_canonical(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Cat on a roomba']);

        $response = $this->get("/posts/{$post->hash}");

        $response->assertOk();
        $response->assertSee('<title>Cat on a roomba - online-trash</title>', escape: false);
        $response->assertSee('<meta name="description" content="Cat on a roomba">', escape: false);
        $response->assertSee(
            "<link rel=\"canonical\" href=\"https://online-trash.com/posts/{$post->hash}\">",
            escape: false,
        );
        $response->assertSee('<meta property="og:type" content="article">', escape: false);
        $response->assertSee('<meta property="og:title" content="Cat on a roomba">', escape: false);
        $response->assertSee('<meta name="twitter:title" content="Cat on a roomba">', escape: false);
        $response->assertDontSee('name="robots"', escape: false);
    }

    /** AS1.1/FR-005: the widest variant that actually exists on disk, absolutised. */
    public function test_a_meme_permalink_points_at_its_widest_existing_image_variant(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Wide load']);
        $this->writeImageVariants($post, ['original', '800', '300']);
        $expected = 'https://online-trash.com' . Storage::disk('public')->url(
            MediaPath::imageRelativePath('800', pathinfo((string) $post->file, PATHINFO_FILENAME), pathinfo((string) $post->file, PATHINFO_EXTENSION)),
        );

        $response = $this->get("/posts/{$post->hash}");

        $response->assertSee('<meta property="og:image" content="' . $expected . '">', escape: false);
        $response->assertSee('<meta name="twitter:image" content="' . $expected . '">', escape: false);
        $response->assertSee('<meta name="twitter:card" content="summary_large_image">', escape: false);
    }

    /** FR-005: with no numeric variant on disk, the original still stands in. */
    public function test_a_meme_with_only_an_original_uses_it_as_the_preview(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Original only']);
        $this->writeImageVariants($post, ['original']);
        $expected = 'https://online-trash.com' . Storage::disk('public')->url(
            MediaPath::imageRelativePath('original', pathinfo((string) $post->file, PATHINFO_FILENAME), pathinfo((string) $post->file, PATHINFO_EXTENSION)),
        );

        $this->get("/posts/{$post->hash}")
            ->assertSee('<meta property="og:image" content="' . $expected . '">', escape: false);
    }

    /** AS1.3: the still already downloaded at upload time — never a fresh HTTP call. */
    public function test_a_youtube_meme_carries_its_stored_thumbnail(): void {
        $post = Trashpost::factory()->visible()->linkOnly()->create(['title' => 'A video meme']);
        $post->youtube_thumbnail = MediaPath::youtubeThumbnailRelativePath((string) $post->youtube);
        $post->save();
        $expected = 'https://online-trash.com' . Storage::disk('public')->url((string) $post->youtube_thumbnail);

        $response = $this->get("/posts/{$post->hash}");

        $response->assertSee('<meta property="og:image" content="' . $expected . '">', escape: false);
        $response->assertSee('<meta name="twitter:card" content="summary_large_image">', escape: false);
    }

    /** AS1.1: an untitled meme reads as the SPA's own fallback, not as an empty tag. */
    public function test_an_untitled_meme_falls_back_to_the_generic_label(): void {
        $post = Trashpost::factory()->visible()->create(['title' => null]);

        $response = $this->get("/posts/{$post->hash}");

        $response->assertSee('<title>Untitled meme - online-trash</title>', escape: false);
        $response->assertSee('<meta name="description" content="An endless feed of memes.">', escape: false);
        $response->assertSee('<meta property="og:title" content="Untitled meme">', escape: false);
    }

    /** FR-006: a card is never left imageless, and a square logo is not stretched. */
    public function test_a_meme_with_no_media_falls_back_to_the_branded_image(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'No media at all', 'file' => null]);

        $response = $this->get("/posts/{$post->hash}");

        $response->assertSee(
            '<meta property="og:image" content="https://online-trash.com/logo-light.png">',
            escape: false,
        );
        $response->assertSee('<meta name="twitter:card" content="summary">', escape: false);
    }

    /**
     * AS1.5, SC-003, FR-010: a pending meme leaks no part of itself to ANYONE —
     * the metadata is a function of public visibility, never of the requester, which
     * is exactly what makes one cache entry per address safe (FR-039).
     */
    public function test_a_pending_meme_leaks_nothing_to_any_requester(): void {
        $post = Trashpost::factory()->hidden()->create([
            'title' => 'Pendingsecrettitle',
            'username' => 'Pendingsecretauthor',
        ]);
        $this->writeImageVariants($post, ['800']);

        foreach ([null, User::factory()->create(), User::factory()->admin()->create()] as $viewer) {
            $response = $viewer === null ? $this->get("/posts/{$post->hash}") : $this->actingAs($viewer)->get("/posts/{$post->hash}");
            $body = (string) $response->getContent();

            $response->assertOk();
            $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
            $this->assertStringNotContainsString('Pendingsecrettitle', $body);
            $this->assertStringNotContainsString('Pendingsecretauthor', $body);
            $this->assertStringNotContainsString((string) $post->file, $body);
        }
    }

    public function test_a_soft_deleted_meme_leaks_nothing_to_any_requester(): void {
        $post = Trashpost::factory()->deleted()->create([
            'title' => 'Deletedsecrettitle',
            'username' => 'Deletedsecretauthor',
        ]);
        $this->writeImageVariants($post, ['800']);

        foreach ([null, User::factory()->admin()->create()] as $viewer) {
            $response = $viewer === null ? $this->get("/posts/{$post->hash}") : $this->actingAs($viewer)->get("/posts/{$post->hash}");
            $body = (string) $response->getContent();

            $response->assertOk();
            $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
            $this->assertStringNotContainsString('Deletedsecrettitle', $body);
            $this->assertStringNotContainsString('Deletedsecretauthor', $body);
            $this->assertStringNotContainsString((string) $post->file, $body);
        }
    }

    /**
     * AS1.6 and every vector in contracts/shell-response.md → Escaping. The document
     * structure must be unmoved: still exactly one <title>, still exactly the shell's
     * own single <script> tag, and the raw value never present verbatim.
     */
    public function test_a_meme_title_cannot_alter_the_response_structure(): void {
        $vectors = [
            'He said "hi"',
            '<script>alert(1)</script>',
            'Tom & Jerry',
            '" /><script>x</script><meta a="',
            "'; alert(1); //",
        ];

        foreach ($vectors as $vector) {
            $post = Trashpost::factory()->visible()->create(['title' => $vector]);

            $body = (string) $this->get("/posts/{$post->hash}")->getContent();

            $this->assertStringNotContainsString($vector, $body, $vector);
            $this->assertSame(1, substr_count($body, '<script'), $vector);
            $this->assertSame(1, substr_count($this->headOf($body), '<title>'), $vector);
        }
    }

    /**
     * US4, contracts/shell-response.md → Status codes. A row that exists is a page,
     * whatever its visibility; only a hash that names no row at all is missing. The
     * split matters because a crawler treats a 200 carrying "not found" as a soft
     * 404 and keeps the address in the index (SC-004).
     */
    public function test_a_publicly_visible_meme_reports_found(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->get("/posts/{$post->hash}")->assertOk();
    }

    /** FR-015: a permitted viewer still gets a working page, so the row is not missing. */
    public function test_a_pending_meme_reports_found(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->get("/posts/{$post->hash}")->assertOk();
    }

    public function test_a_soft_deleted_meme_reports_found(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->get("/posts/{$post->hash}")->assertOk();
    }

    /**
     * A purged meme and a hash that never existed are the same thing to the server —
     * there is no row — and both are genuinely missing.
     */
    public function test_a_purged_meme_reports_not_found(): void {
        $post = Trashpost::factory()->visible()->create();
        $hash = (string) $post->hash;
        $post->forceDelete();

        $this->get("/posts/{$hash}")->assertNotFound();
    }

    public function test_a_hash_that_never_existed_reports_not_found(): void {
        $this->get('/posts/zzzzzzzzzz')->assertNotFound();
    }

    /**
     * A malformed identifier is not a permalink at all, so it fails the address
     * table rather than becoming a query (Constitution V).
     */
    public function test_a_malformed_hash_reports_not_found(): void {
        foreach (['/posts/abc', '/posts/aB3dEf7GhJx', '/posts'] as $path) {
            $this->get($path)->assertNotFound();
        }
    }

    /** Every private address is a real page — noindex, but present. */
    public function test_every_non_indexable_static_address_reports_found(): void {
        $paths = ['/login', '/register', '/account', '/upload', '/verify-email', '/admin/trashposts', '/admin/users'];

        foreach ($paths as $path) {
            $response = $this->get($path);

            $response->assertOk();
            $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
        }
    }

    /**
     * FR-014: a 404 carries the same shell, so the SPA renders its existing
     * NotFoundPage rather than the framework's error page.
     */
    public function test_a_not_found_permalink_still_carries_the_shell(): void {
        $body = (string) $this->get('/posts/zzzzzzzzzz')->getContent();

        $this->assertStringContainsString('<div id="root">', $body);
        $this->assertSame(
            substr($this->fixture(), (int) strpos($this->fixture(), '</head>')),
            substr($body, (int) strpos($body, '</head>')),
        );
    }

    /**
     * FR-038: metadata is an enhancement, never a dependency. If resolution fails the
     * address still answers at the status the route table decided, with the generic
     * block and a robots tag — degraded, but never a 5xx handed to a crawler.
     */
    public function test_a_metadata_failure_degrades_instead_of_erroring(): void {
        $this->app->instance(PageMetaService::class, new ThrowingPageMetaService());

        foreach (['/' => 200, '/login' => 200, '/posts/zzzzzzzzzz' => 200, '/nope' => 404] as $path => $status) {
            $response = $this->get($path);

            $response->assertStatus($status);
            $response->assertSee('<title>online-trash</title>', escape: false);
            $response->assertSee('<meta name="robots" content="noindex, follow">', escape: false);
            $this->assertStringContainsString('<div id="root">', (string) $response->getContent(), $path);
        }
    }

    /**
     * The degraded response canonicalises to the address itself, so the fallback
     * cannot quietly point every failing page at the origin root.
     */
    public function test_a_degraded_response_still_canonicalises_to_its_own_address(): void {
        $this->app->instance(PageMetaService::class, new ThrowingPageMetaService());

        $this->get('/login')->assertSee(
            '<link rel="canonical" href="https://online-trash.com/login">',
            escape: false,
        );
    }

    /**
     * A missing shell template is deliberately OUTSIDE the FR-038 fallback: there is
     * no useful page to serve without it, so it fails loudly (research D11).
     * deploy/php/entrypoint.sh turns this into a boot failure, which is where a
     * packaging error belongs — degrading it here would hide that.
     */
    public function test_a_missing_shell_template_is_a_server_error(): void {
        config(['seo.shell_path' => base_path('tests/fixtures/no-such-shell.html')]);

        $this->get('/')->assertStatus(500);
    }
}

/**
 * A PageMetaService whose every answer fails, for the FR-038 degradation cases.
 * Declared here rather than mocked so the failure is a plain, readable throw.
 */
final class ThrowingPageMetaService extends PageMetaService {
    public function forPath(string $path): PageMeta {
        throw new RuntimeException('Metadata resolution failed.');
    }

    public function statusFor(string $path): int {
        throw new RuntimeException('Metadata resolution failed.');
    }
}
