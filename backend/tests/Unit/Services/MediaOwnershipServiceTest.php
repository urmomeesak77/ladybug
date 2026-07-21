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

        $this->assertCount(count(MediaPath::imageSizes()) + 1, $paths);
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

    public function test_owned_paths_is_empty_for_a_post_with_no_media(): void {
        $post = Trashpost::factory()->linkOnly()->create([
            'file' => null, 'youtube_thumbnail' => null,
        ]);

        $this->assertSame([], $this->service()->ownedPaths($post));
    }
}
