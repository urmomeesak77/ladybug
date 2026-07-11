<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\MediaVisibilityService;
use App\Support\MediaPath;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

/**
 * Media must live on the disk that matches the meme's visibility: the public disk is
 * URL-addressable by anyone who ever saw the hash, so a hidden meme's files have to
 * physically leave it. sync() is idempotent — repeated transitions converge.
 */
final class MediaVisibilityServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): MediaVisibilityService {
        return new MediaVisibilityService();
    }

    private function seedVariants(string $code, string $ext): array {
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->put($path, "bytes-{$size}");
            $paths[] = $path;
        }

        return $paths;
    }

    public function test_sync_moves_a_hidden_memes_variants_off_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $paths = $this->seedVariants('abc', 'jpg');
        $post->delete();

        $this->service()->sync($post);

        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
            Storage::disk('local')->assertExists($path);
        }
        $this->assertSame('bytes-original', Storage::disk('local')->get($paths[0]));
    }

    public function test_sync_moves_a_visible_memes_variants_back_to_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->sync($post);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertExists($path);
    }

    public function test_sync_is_idempotent_when_files_are_already_in_place(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->sync($post);
        $this->service()->sync($post);

        Storage::disk('public')->assertExists($path);
        $this->assertSame('bytes', Storage::disk('public')->get($path));
    }

    public function test_a_thumbnail_shared_with_another_meme_is_not_moved(): void {
        Storage::fake('public');
        Storage::fake('local');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumb, 'still');
        $hidden = Trashpost::factory()->deleted()->create([
            'type' => 'youtube', 'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);
        Trashpost::factory()->create([
            'activated_at' => now(), 'type' => 'youtube',
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);

        $this->service()->sync($hidden);

        // Yanking the shared still would break the other, live meme's thumbnail.
        Storage::disk('public')->assertExists($thumb);
    }

    public function test_a_failed_target_write_never_deletes_the_source(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->deleted()->create([
            'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');
        // Simulate a full/unwritable private disk: both disks are throw=false, so a
        // failed put() surfaces as a false return, not an exception.
        $target = Mockery::mock(FilesystemAdapter::class);
        $target->shouldReceive('put')->atLeast()->once()->andReturn(false);
        Storage::set('local', $target);

        $this->service()->sync($post);

        // A failed copy must never destroy the only copy.
        Storage::disk('public')->assertExists($path);
        $this->assertSame('bytes', Storage::disk('public')->get($path));
    }

    public function test_owned_paths_lists_every_variant_and_the_unshared_thumbnail(): void {
        Storage::fake('public');
        Storage::fake('local');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->create([
            'file' => 'abc.jpg', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertCount(count(MediaPath::imageSizes()) + 1, $paths);
        $this->assertContains(MediaPath::imageRelativePath('100', 'abc', 'jpg'), $paths);
        $this->assertContains($thumb, $paths);
    }
}
