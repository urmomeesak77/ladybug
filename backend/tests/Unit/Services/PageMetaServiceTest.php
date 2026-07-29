<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\PageMetaService;
use App\Support\PageMeta;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Resolution of one address to its <head> metadata, and the cache that fronts it.
 *
 * The security-relevant case here is the non-public meme: whatever the row holds,
 * the resolved object must be indistinguishable from any other generic page
 * (FR-010), because this layer is the only one that ever reads the row.
 */
final class PageMetaServiceTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // No test may reach the real bind-mounted media tree.
        Storage::fake('public');
        config([
            'app.url' => 'https://online-trash.com',
            'seo.site_name' => 'online-trash',
            'seo.site_description' => 'An endless feed of memes.',
            'seo.fallback_image' => '/logo-light.png',
            'seo.untitled_label' => 'Untitled meme',
            'seo.cache_ttl' => 3600,
        ]);
    }

    private function service(): PageMetaService {
        return new PageMetaService();
    }

    /** The key the contract fixes, spelled out here rather than read off the class. */
    private function key(string $path): string {
        return 'seo:meta:v1:' . sha1($path);
    }

    public function test_a_publicly_visible_meme_resolves_to_its_own_metadata(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Cat on a roomba']);

        $meta = $this->service()->forPath("/posts/{$post->hash}");

        $this->assertSame('Cat on a roomba - online-trash', $meta->title);
        $this->assertSame('Cat on a roomba', $meta->socialTitle);
        $this->assertSame("https://online-trash.com/posts/{$post->hash}", $meta->canonical);
        $this->assertSame('article', $meta->ogType);
        $this->assertTrue($meta->isIndexable);
    }

    /** FR-011/FR-015: the page still works, but it is generic and it is noindex. */
    public function test_a_pending_meme_resolves_to_site_metadata_marked_noindex(): void {
        $post = Trashpost::factory()->hidden()->create(['title' => 'Awaiting a moderator']);

        $meta = $this->service()->forPath("/posts/{$post->hash}");

        $this->assertSame('online-trash', $meta->title);
        $this->assertSame('An endless feed of memes.', $meta->description);
        $this->assertSame('https://online-trash.com/logo-light.png', $meta->imageUrl);
        $this->assertFalse($meta->isIndexable);
    }

    public function test_a_soft_deleted_meme_resolves_to_site_metadata_marked_noindex(): void {
        $post = Trashpost::factory()->deleted()->create(['title' => 'Taken down']);

        $meta = $this->service()->forPath("/posts/{$post->hash}");

        $this->assertSame('online-trash', $meta->title);
        $this->assertSame('An endless feed of memes.', $meta->description);
        $this->assertFalse($meta->isIndexable);
    }

    /** A hash matching no row at all is generic too; the status split is US4's job. */
    public function test_an_unknown_hash_resolves_to_site_metadata(): void {
        $meta = $this->service()->forPath('/posts/zzzzzzzzzz');

        $this->assertSame('online-trash', $meta->title);
        $this->assertFalse($meta->isIndexable);
    }

    public function test_the_home_feed_resolves_to_indexable_site_metadata(): void {
        $meta = $this->service()->forPath('/');

        $this->assertSame('online-trash', $meta->title);
        $this->assertSame('https://online-trash.com/', $meta->canonical);
        $this->assertTrue($meta->isIndexable);
    }

    public function test_an_account_address_resolves_to_non_indexable_site_metadata(): void {
        $meta = $this->service()->forPath('/login');

        $this->assertSame('https://online-trash.com/login', $meta->canonical);
        $this->assertFalse($meta->isIndexable);
    }

    public function test_resolved_metadata_is_cached_under_a_key_derived_from_the_path(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Cached meme']);

        $this->service()->forPath("/posts/{$post->hash}");

        $payload = Cache::get($this->key("/posts/{$post->hash}"));
        $this->assertIsArray($payload);
        $this->assertSame('Cached meme - online-trash', $payload['title']);
    }

    /**
     * FR-039: one entry per address. Two permalinks differ in their path, so they
     * differ in their key — one meme's metadata can never be served under another's
     * address.
     */
    public function test_two_addresses_never_share_a_cache_entry(): void {
        $one = Trashpost::factory()->visible()->create(['title' => 'First meme']);
        $two = Trashpost::factory()->visible()->create(['title' => 'Second meme']);
        $service = $this->service();

        $service->forPath("/posts/{$one->hash}");
        $service->forPath("/posts/{$two->hash}");

        $this->assertSame('First meme - online-trash', Cache::get($this->key("/posts/{$one->hash}"))['title']);
        $this->assertSame('Second meme - online-trash', Cache::get($this->key("/posts/{$two->hash}"))['title']);
    }

    /** The warm path is a single cache read: SC-011's budget depends on it. */
    public function test_a_second_resolve_inside_the_ttl_performs_no_query(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Warm meme']);
        $service = $this->service();
        $service->forPath("/posts/{$post->hash}");

        DB::enableQueryLog();
        $meta = $service->forPath("/posts/{$post->hash}");
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame([], $queries);
        $this->assertSame('Warm meme - online-trash', $meta->title);
    }

    /** FR-040: a transition drops that meme's entry and nothing else. */
    public function test_forget_drops_exactly_that_memes_entry(): void {
        $one = Trashpost::factory()->visible()->create(['title' => 'Dropped meme']);
        $two = Trashpost::factory()->visible()->create(['title' => 'Kept meme']);
        $service = $this->service();
        $service->forPath("/posts/{$one->hash}");
        $service->forPath("/posts/{$two->hash}");

        $service->forget($one->hash);

        $this->assertNull(Cache::get($this->key("/posts/{$one->hash}")));
        $this->assertNotNull(Cache::get($this->key("/posts/{$two->hash}")));
    }

    /**
     * US4: the status is the one thing the address table cannot decide for a
     * permalink, because only the row says whether the address is a page at all.
     */
    public function test_status_for_a_publicly_visible_meme_is_found(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->assertSame(200, $this->service()->statusFor("/posts/{$post->hash}"));
    }

    /** A hidden meme is still a page (FR-015) — it just says nothing about itself. */
    public function test_status_for_a_pending_meme_is_found(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->assertSame(200, $this->service()->statusFor("/posts/{$post->hash}"));
    }

    public function test_status_for_a_soft_deleted_meme_is_found(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->assertSame(200, $this->service()->statusFor("/posts/{$post->hash}"));
    }

    /** No row at all — purged or never minted — is genuinely missing (SC-004). */
    public function test_status_for_a_hash_with_no_row_is_not_found(): void {
        $this->assertSame(404, $this->service()->statusFor('/posts/zzzzzzzzzz'));
    }

    public function test_status_for_a_known_static_address_is_found(): void {
        $this->assertSame(200, $this->service()->statusFor('/login'));
    }

    public function test_status_for_an_address_the_spa_has_no_view_for_is_not_found(): void {
        $this->assertSame(404, $this->service()->statusFor('/nope'));
    }

    /**
     * The metadata and the status come off ONE record. Asking for them separately
     * must not resolve the address twice, or a transition landing between the two
     * calls would pair one meme's body with another verdict on whether it exists.
     */
    public function test_the_status_and_the_metadata_come_from_a_single_resolution(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Consistent meme']);
        $service = $this->service();
        $service->forPath("/posts/{$post->hash}");

        DB::enableQueryLog();
        $status = $service->statusFor("/posts/{$post->hash}");
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame([], $queries);
        $this->assertSame(200, $status);
    }

    /**
     * The invariant the memo exists for. A moderation transition landing between the
     * two calls invalidates the shared entry; the instance already part-way through
     * a request must NOT re-resolve, or it would pair a real meme's title and
     * og:image with the 404 of a purged one. Consistency within the response wins —
     * the next request, on a fresh instance, sees the new state.
     */
    public function test_a_transition_landing_mid_request_cannot_split_metadata_from_status(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Mid-flight meme']);
        $hash = (string) $post->hash;
        $service = $this->service();
        $meta = $service->forPath("/posts/{$hash}");

        // A concurrent purge, through the separate instance ModerationService holds.
        $post->forceDelete();
        $this->service()->forget($hash);

        $this->assertSame('Mid-flight meme - online-trash', $meta->title);
        $this->assertSame(200, $service->statusFor("/posts/{$hash}"));
        // ...and the very next request does see it gone (FR-040).
        $this->assertSame(404, $this->service()->statusFor("/posts/{$hash}"));
    }

    /**
     * An entry written by a release that predates the status key is a MISS, not an
     * entry to be trusted with a default. Without this, the hour after a deploy
     * could answer 200 for an address whose row is gone — a soft 404 (SC-004).
     */
    public function test_a_cache_entry_without_a_status_is_treated_as_a_miss(): void {
        $path = '/posts/zzzzzzzzzz';
        // The exact shape the previous release wrote: a serialized PageMeta, no more.
        Cache::put($this->key($path), PageMeta::site('https://online-trash.com' . $path, false)->toArray(), 3600);

        $this->assertSame(404, $this->service()->statusFor($path));
    }

    /**
     * A deactivation between two requests must show up on the next one, not an hour
     * later — the whole point of FR-040.
     */
    public function test_a_forgotten_entry_is_resolved_again_from_the_row(): void {
        $post = Trashpost::factory()->visible()->create(['title' => 'Briefly public']);
        $service = $this->service();
        $service->forPath("/posts/{$post->hash}");

        $post->activated_at = null;
        $post->save();
        $service->forget($post->hash);

        $this->assertFalse($service->forPath("/posts/{$post->hash}")->isIndexable);
    }
}
