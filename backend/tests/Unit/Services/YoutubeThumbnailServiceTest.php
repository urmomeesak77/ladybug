<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\YoutubeThumbnailService;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The lazy one-time YouTube thumbnail fetcher: on first render it downloads the still,
 * stores it once under the dedicated media subtree, records the relative path, and
 * returns the public URL. Already-fetched memes reuse the stored file with no HTTP
 * (SC-004); any failure is best-effort and returns null (never throws).
 */
final class YoutubeThumbnailServiceTest extends TestCase {
    use RefreshDatabase;

    private const VIDEO_ID = 'dQw4w9WgXcQ';

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    private function service(): YoutubeThumbnailService {
        return new YoutubeThumbnailService();
    }

    /** A persisted YouTube meme carrying a valid 11-char id and no stored thumbnail. */
    private function youtubePost(): Trashpost {
        return Trashpost::factory()->linkOnly()->create([
            'youtube' => self::VIDEO_ID,
            'youtube_thumbnail' => null,
        ]);
    }

    public function test_fetches_stores_and_persists_the_relative_path_on_success(): void {
        Http::fake(['img.youtube.com/*' => Http::response('IMG-BYTES', 200)]);
        $post = $this->youtubePost();
        $rel = MediaPath::youtubeThumbnailRelativePath(self::VIDEO_ID);

        $url = $this->service()->ensure($post);

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame($disk->url($rel), $url);
        $disk->assertExists($rel);
        $this->assertSame($rel, $post->fresh()->youtube_thumbnail);
    }

    public function test_reuses_a_stored_thumbnail_without_any_http_call(): void {
        Http::fake();
        $rel = MediaPath::youtubeThumbnailRelativePath(self::VIDEO_ID);
        Storage::disk('public')->put($rel, 'IMG-BYTES');
        $post = Trashpost::factory()->linkOnly()->create([
            'youtube' => self::VIDEO_ID,
            'youtube_thumbnail' => $rel,
        ]);

        $url = $this->service()->ensure($post);

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame($disk->url($rel), $url);
        Http::assertNothingSent();
    }

    public function test_returns_null_and_leaves_the_column_unset_on_a_failed_fetch(): void {
        Http::fake(['img.youtube.com/*' => Http::response('nope', 404)]);
        $post = $this->youtubePost();

        $url = $this->service()->ensure($post);

        $this->assertNull($url);
        $this->assertNull($post->fresh()->youtube_thumbnail);
    }

    public function test_returns_null_without_an_http_call_when_the_id_is_invalid(): void {
        Http::fake();
        $post = Trashpost::factory()->linkOnly()->create([
            'youtube' => 'not-a-valid-id',
            'youtube_thumbnail' => null,
        ]);

        $this->assertNull($this->service()->ensure($post));
        Http::assertNothingSent();
    }

    public function test_returns_null_when_the_http_client_throws(): void {
        Http::fake(fn () => throw new \RuntimeException('connection reset'));
        $post = $this->youtubePost();

        $this->assertNull($this->service()->ensure($post));
        $this->assertNull($post->fresh()->youtube_thumbnail);
    }

    public function test_a_stored_thumbnail_missing_from_the_public_disk_yields_null(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create([
            'type' => 'youtube', 'youtube' => 'dQw4w9WgXcQ',
            'youtube_thumbnail' => 'image/trash/youtube/d/dQw4w9WgXcQ.jpg',
        ]);

        $this->assertNull((new YoutubeThumbnailService())->ensure($post));
    }
}
