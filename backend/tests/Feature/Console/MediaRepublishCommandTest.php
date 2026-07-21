<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * media:republish moves any owned media file still on the private 'local' disk (left by
 * the old move-on-hide code) back to 'public', so already-hidden memes render for admins.
 * Idempotent: files already on 'public' are left alone, so re-running is a no-op.
 */
final class MediaRepublishCommandTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('local');
    }

    public function test_it_moves_a_hidden_memes_files_from_local_to_public(): void {
        $post = Trashpost::factory()->deleted()->create(['file' => 'abc.jpg', 'type' => 'image']);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->artisan('media:republish')->assertSuccessful();

        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame('bytes', Storage::disk('public')->get($path));
    }

    public function test_it_leaves_files_already_on_public_untouched(): void {
        $post = Trashpost::factory()->create(['activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image']);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'public-bytes');

        $this->artisan('media:republish')->assertSuccessful();
        // Re-running is a no-op.
        $this->artisan('media:republish')->assertSuccessful();

        Storage::disk('public')->assertExists($path);
        $this->assertSame('public-bytes', Storage::disk('public')->get($path));
    }
}
