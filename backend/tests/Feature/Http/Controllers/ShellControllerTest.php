<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Models\User;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
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
}
