<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class OgImageControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // No test may reach the real bind-mounted media tree.
        Storage::fake('public');
    }

    /** Real encoded bytes, so the transcode has something GD can actually decode. */
    private function webpBytes(int $width, int $height): string {
        $img = imagecreatetruecolor($width, $height);
        ob_start();
        imagewebp($img);
        $bytes = (string) ob_get_clean();
        imagedestroy($img);

        return $bytes;
    }

    /** A visible WebP post with one variant on disk — the case X cannot render today. */
    private function webpPost(string $size = '300'): Trashpost {
        $post = Trashpost::factory()->visible()->create();
        $post->file = $post->hash . '.webp';
        $post->save();
        Storage::disk('public')->put(
            MediaPath::imageRelativePath($size, $post->hash, 'webp'),
            $this->webpBytes(300, 270),
        );

        return $post;
    }

    public function test_it_serves_a_jpeg_for_a_visible_webp_post(): void {
        $post = $this->webpPost();

        $response = $this->get("/og/{$post->hash}.jpg");

        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/jpeg');
        // The served file itself, not just the declared type: a Content-Type header
        // over WebP bytes is exactly the failure this whole route exists to prevent.
        $bytes = Storage::disk('public')->get(MediaPath::ogRelativePath($post->hash));
        $this->assertSame('FFD8FF', strtoupper(bin2hex(substr((string) $bytes, 0, 3))));
    }

    public function test_it_caches_the_generated_jpeg_on_the_public_disk(): void {
        $post = $this->webpPost();

        $this->get("/og/{$post->hash}.jpg")->assertOk();

        Storage::disk('public')->assertExists(MediaPath::ogRelativePath($post->hash));
    }

    public function test_a_second_request_serves_the_cached_file_without_regenerating(): void {
        $post = $this->webpPost();
        $this->get("/og/{$post->hash}.jpg")->assertOk();
        // Remove the SOURCE. A second request that still succeeds can only be reading
        // the cached JPEG — there is nothing left to transcode from.
        Storage::disk('public')->delete(MediaPath::imageRelativePath('300', $post->hash, 'webp'));

        $this->get("/og/{$post->hash}.jpg")->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    }

    public function test_it_sends_a_long_lived_cache_header(): void {
        $post = $this->webpPost();

        $response = $this->get("/og/{$post->hash}.jpg");

        // Laravel normalises the directive order; the set is what matters.
        $this->assertSame('immutable, max-age=2592000, public', $response->headers->get('Cache-Control'));
    }

    public function test_it_404s_for_an_unknown_hash(): void {
        $this->get('/og/0000000000.jpg')->assertNotFound();
    }

    public function test_it_404s_for_a_pending_post(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->get("/og/{$post->hash}.jpg")->assertNotFound();
    }

    public function test_it_404s_for_a_soft_deleted_post(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->get("/og/{$post->hash}.jpg")->assertNotFound();
    }

    public function test_it_404s_for_a_post_with_no_media_on_disk(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->get("/og/{$post->hash}.jpg")->assertNotFound();
    }

    public function test_it_404s_rather_than_500s_when_the_source_cannot_be_decoded(): void {
        $post = Trashpost::factory()->visible()->create();
        $post->file = $post->hash . '.webp';
        $post->save();
        Storage::disk('public')->put(
            MediaPath::imageRelativePath('300', $post->hash, 'webp'),
            'not actually an image',
        );

        $this->get("/og/{$post->hash}.jpg")->assertNotFound();
    }

    public function test_a_malformed_hash_does_not_reach_the_route(): void {
        // The SPA catch-all answers this instead — the {hash} constraint must not be
        // loose enough to let a nine-character or dotted identifier become a query.
        $this->get('/og/short.jpg')->assertNotFound();
    }

    public function test_it_serves_a_jpeg_for_an_animated_webp_post(): void {
        $post = Trashpost::factory()->visible()->create();
        $post->file = $post->hash . '.webp';
        $post->save();
        Storage::disk('public')->put(
            MediaPath::imageRelativePath('300', $post->hash, 'webp'),
            (string) file_get_contents(base_path('tests/fixtures/animated.webp')),
        );

        $this->get("/og/{$post->hash}.jpg")->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    }

    public function test_it_404s_rather_than_500s_when_gd_raises_on_the_source(): void {
        // An animated WebP with its animation flag cleared: the router sends it down the
        // GD path, where imagecreatefromwebp() fails on the animated body with a PHP
        // warning — an ErrorException, NOT the RuntimeException the happy path throws.
        // A preview that cannot be built must never take the response down with it.
        $post = Trashpost::factory()->visible()->create();
        $post->file = $post->hash . '.webp';
        $post->save();
        $bytes = (string) file_get_contents(base_path('tests/fixtures/animated.webp'));
        $bytes[20] = chr(ord($bytes[20]) & ~0x02);
        Storage::disk('public')->put(MediaPath::imageRelativePath('300', $post->hash, 'webp'), $bytes);

        $this->get("/og/{$post->hash}.jpg")->assertNotFound();
    }
}
