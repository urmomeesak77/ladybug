<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\MediaOwnershipService;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ownedPaths lists exactly the disk files a meme owns — every image size variant, plus its
 * YouTube thumbnail only when no other (trashed included) post shares that still. Used by
 * purge to know what to delete.
 */
final class MediaOwnershipServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): MediaOwnershipService {
        return new MediaOwnershipService();
    }

    public function test_owned_paths_lists_every_variant_and_the_unshared_thumbnail(): void {
        Storage::fake('public');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->create([
            'file' => 'abc.jpg', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        // Every image size, plus the unshared thumbnail, plus the unfurl preview.
        $this->assertCount(count(MediaPath::imageSizes()) + 2, $paths);
        $this->assertContains(MediaPath::imageRelativePath('100', 'abc', 'jpg'), $paths);
        $this->assertContains($thumb, $paths);
    }

    public function test_owned_paths_omits_a_thumbnail_shared_with_another_post(): void {
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);
        Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertNotContains($thumb, $paths);
    }

    public function test_owned_paths_includes_the_unfurl_preview(): void {
        // Generated lazily by OgImageService and keyed by the post's own hash, so it is
        // never shared — but a purge that skipped it would leave the meme's picture
        // still fetchable at /og/{hash}.jpg after every other byte was deleted.
        $post = Trashpost::factory()->create(['file' => 'abc.jpg']);

        $this->assertContains(MediaPath::ogRelativePath($post->hash), $this->service()->ownedPaths($post));
    }

    public function test_owned_paths_includes_the_unfurl_preview_of_a_youtube_post(): void {
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $shared = Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);
        Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($shared);

        // The still itself is shared and must survive; the preview derived from it is
        // this post's alone and must not.
        $this->assertNotContains($thumb, $paths);
        $this->assertContains(MediaPath::ogRelativePath($shared->hash), $paths);
    }

    public function test_owned_paths_is_empty_for_a_post_with_no_media(): void {
        $post = Trashpost::factory()->linkOnly()->create([
            'file' => null, 'youtube_thumbnail' => null,
        ]);

        $this->assertSame([], $this->service()->ownedPaths($post));
    }

    public function test_owned_paths_for_a_video_post_lists_the_video_file_and_poster_variants(): void {
        $post = Trashpost::factory()->create([
            'type' => 'video', 'file' => 'abc.mp4', 'poster' => 'abc.jpg',
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertContains(MediaPath::videoRelativePath('abc', 'mp4'), $paths);
        foreach (MediaPath::imageSizes() as $size) {
            $this->assertContains(MediaPath::imageRelativePath($size, 'abc', 'jpg'), $paths);
        }
        // Every poster size, plus the video file, plus the unfurl preview.
        $this->assertCount(count(MediaPath::imageSizes()) + 2, $paths);
        // The old image-`file`-keyed paths (as if `file` were an image) must not appear.
        $this->assertNotContains(MediaPath::imageRelativePath('100', 'abc', 'mp4'), $paths);
    }
}
