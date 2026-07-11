<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class TrashpostsApiControllerTest extends TestCase {
    use RefreshDatabase;

    public function test_feed_returns_visible_posts_newest_first_under_a_data_envelope(): void {
        $older = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);
        $newer = Trashpost::factory()->visible()->create(['activated_at' => now()]);

        $response = $this->getJson('/api/posts');

        $response->assertOk();
        $response->assertJsonPath('data.0.hash', $newer->hash);
        $response->assertJsonPath('data.1.hash', $older->hash);
    }

    public function test_feed_item_exposes_the_documented_json_shape(): void {
        $post = Trashpost::factory()->visible()->create();

        $response = $this->getJson('/api/posts');

        $response->assertJsonStructure([
            'data' => [[
                'hash', 'title', 'type', 'file', 'youtube',
                'username', 'metadata',
                'created_at', 'activated_at',
                'url', 'url_api', 'original', 'default', 'sizes',
            ]],
        ]);
        $response->assertJsonPath('data.0.url', "/posts/{$post->hash}");
        $this->assertStringEndsWith(
            "/api/posts/{$post->hash}",
            $response->json('data.0.url_api'),
        );
    }

    public function test_feed_item_does_not_leak_internal_fields(): void {
        Trashpost::factory()->visible()->create();

        $item = $this->getJson('/api/posts')->json('data.0');

        // The hash is the public identifier (Principle V); the DB id, owner id, and
        // soft-delete bookkeeping are internal and stay out of the payload.
        foreach (['id', 'user_id', 'deleted_at', 'comment'] as $internal) {
            $this->assertArrayNotHasKey($internal, $item);
        }
    }

    public function test_feed_caps_a_page_at_ten_posts(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->getJson('/api/posts')->assertJsonCount(10, 'data');
    }

    public function test_feed_is_publicly_readable_without_an_auth_header(): void {
        Trashpost::factory()->visible()->create();

        // No Sanctum actingAs / Authorization header: the read feed is public (FR-012).
        $this->getJson('/api/posts')->assertOk();
    }

    public function test_feed_cursor_paging_walks_pages_with_no_overlap_or_gap(): void {
        Trashpost::factory()->count(5)->visible()->create();

        $page1 = $this->getJson('/api/posts?limit=2');
        $page1->assertJsonCount(2, 'data');
        $cursor = $page1->json('data.1.hash');

        $page2 = $this->getJson("/api/posts?limit=2&start={$cursor}");
        $page2->assertJsonCount(2, 'data');

        $seen = array_merge($page1->json('data.*.hash'), $page2->json('data.*.hash'));
        $this->assertSame($seen, array_unique($seen), 'pages must not overlap');
    }

    public function test_feed_cursor_includes_an_older_post_with_a_larger_id(): void {
        // The non-monotonic-id scenario: an older post inserted after the cursor.
        $cursor = Trashpost::factory()->visible()->create(['activated_at' => now()]);
        $olderButLargerId = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);

        $response = $this->getJson("/api/posts?start={$cursor->hash}");

        $response->assertJsonPath('data.0.hash', $olderButLargerId->hash);
    }

    public function test_feed_returns_an_empty_data_array_when_no_posts_are_visible(): void {
        Trashpost::factory()->hidden()->create();

        $response = $this->getJson('/api/posts');

        $response->assertOk();
        $response->assertExactJson(['data' => []]);
    }

    public function test_show_returns_a_visible_post_under_a_data_envelope(): void {
        $post = Trashpost::factory()->visible()->create();

        $response = $this->getJson("/api/posts/{$post->hash}");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $post->hash);
    }

    public function test_show_is_publicly_readable_without_an_auth_header(): void {
        $post = Trashpost::factory()->visible()->create();

        // No Sanctum actingAs / Authorization header: single-post reads are public (FR-012).
        $this->getJson("/api/posts/{$post->hash}")->assertOk();
    }

    public function test_show_returns_404_for_an_unknown_hash(): void {
        $this->getJson('/api/posts/__nomatch__')->assertNotFound();
    }

    public function test_show_returns_404_for_a_hidden_post(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->getJson("/api/posts/{$post->hash}")->assertNotFound();
    }

    public function test_show_returns_404_for_a_soft_deleted_post(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->getJson("/api/posts/{$post->hash}")->assertNotFound();
    }

    public function test_show_returns_only_image_sizes_present_on_disk(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->visible()->create(['file' => 'abc1234567.jpg']);
        foreach (['original', '300', '100'] as $size) {
            Storage::disk('public')->put(MediaPath::imageRelativePath($size, 'abc1234567', 'jpg'), 'x');
        }

        $response = $this->getJson("/api/posts/{$post->hash}");

        $response->assertOk();
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $response->assertJsonPath('data.sizes', [
            ['url' => $disk->url(MediaPath::imageRelativePath('300', 'abc1234567', 'jpg')), 'width' => 300],
            ['url' => $disk->url(MediaPath::imageRelativePath('100', 'abc1234567', 'jpg')), 'width' => 100],
        ]);
        $this->assertNotNull($response->json('data.default'));
    }

    public function test_show_returns_empty_image_data_for_a_link_only_post(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->visible()->linkOnly()->create();

        $response = $this->getJson("/api/posts/{$post->hash}");

        $response->assertOk();
        $response->assertJsonPath('data.original', null);
        $response->assertJsonPath('data.default', null);
        $response->assertJsonPath('data.sizes', []);
    }
}
