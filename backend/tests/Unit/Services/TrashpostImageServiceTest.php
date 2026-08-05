<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\TrashpostImageService;
use App\Support\MediaPath;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class TrashpostImageServiceTest extends TestCase {
    private const CODE = 'abc1234567';

    private const EXT = 'jpg';

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    private function service(): TrashpostImageService {
        return new TrashpostImageService();
    }

    /** A post carrying the canonical media file, with no DB round-trip needed. */
    private function imagePost(): Trashpost {
        return new Trashpost(['file' => self::CODE . '.' . self::EXT]);
    }

    /** Write a fake file for one size at its canonical path and return that path. */
    private function putSize(string $size): string {
        $rel = MediaPath::imageRelativePath($size, self::CODE, self::EXT);
        Storage::disk('public')->put($rel, 'fake-bytes');

        return $rel;
    }

    private function urlFor(string $size): string {
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->url(MediaPath::imageRelativePath($size, self::CODE, self::EXT));
    }

    public function test_lists_only_the_numeric_sizes_present_on_disk(): void {
        $this->putSize('original');
        $this->putSize('300');
        $this->putSize('100');

        $data = $this->service()->imageData($this->imagePost());

        // 800 and 500 were never written, so they must be absent.
        $this->assertSame([300, 100], array_column($data['sizes'], 'width'));
    }

    public function test_numeric_sizes_are_url_width_pairs_widest_first(): void {
        $this->putSize('100');
        $this->putSize('500');
        $this->putSize('300');

        $data = $this->service()->imageData($this->imagePost());

        $this->assertSame([500, 300, 100], array_column($data['sizes'], 'width'));
        $this->assertSame($this->urlFor('500'), $data['sizes'][0]['url']);
    }

    public function test_original_is_the_original_url_when_present(): void {
        $this->putSize('original');

        $this->assertSame($this->urlFor('original'), $this->service()->imageData($this->imagePost())['original']);
    }

    public function test_original_is_null_when_the_original_file_is_absent(): void {
        $this->putSize('300');

        $this->assertNull($this->service()->imageData($this->imagePost())['original']);
    }

    public function test_default_prefers_the_800_size_when_present(): void {
        $this->putSize('original');
        $this->putSize('800');
        $this->putSize('300');

        $this->assertSame($this->urlFor('800'), $this->service()->imageData($this->imagePost())['default']);
    }

    public function test_default_falls_back_to_the_widest_present_numeric_size(): void {
        // No 800 on disk; the widest numeric present is 500.
        $this->putSize('original');
        $this->putSize('500');
        $this->putSize('300');

        $this->assertSame($this->urlFor('500'), $this->service()->imageData($this->imagePost())['default']);
    }

    public function test_default_falls_back_to_original_when_no_numeric_size_exists(): void {
        $this->putSize('original');

        $this->assertSame($this->urlFor('original'), $this->service()->imageData($this->imagePost())['default']);
    }

    public function test_default_and_original_are_null_when_no_image_files_exist(): void {
        $data = $this->service()->imageData($this->imagePost());

        $this->assertNull($data['default']);
        $this->assertNull($data['original']);
        $this->assertSame([], $data['sizes']);
    }

    public function test_a_post_without_a_file_returns_empty_image_data(): void {
        $data = $this->service()->imageData(new Trashpost(['file' => null]));

        $this->assertSame(['original' => null, 'default' => null, 'sizes' => []], $data);
    }

    public function test_lists_the_1200_size_widest_first_when_present(): void {
        $this->putSize('1200');
        $this->putSize('800');
        $this->putSize('300');

        $data = $this->service()->imageData($this->imagePost());

        // 1200 is the widest numeric size and must lead the list.
        $this->assertSame([1200, 800, 300], array_column($data['sizes'], 'width'));
    }

    public function test_default_still_prefers_800_even_when_1200_exists(): void {
        $this->putSize('1200');
        $this->putSize('800');

        // The src fallback stays 800; the large sizes are served through srcset, not default.
        $this->assertSame($this->urlFor('800'), $this->service()->imageData($this->imagePost())['default']);
    }

    /**
     * A video post's `file` holds the video's own filename (a non-image extension); its
     * poster — always `.jpg` — is what original/default/sizes must describe (data-model.md,
     * research.md #4). Ignoring `file` for a video post and resolving from `poster` instead
     * is the fix under test here.
     */
    private function videoPost(): Trashpost {
        return new Trashpost(['type' => 'video', 'file' => self::CODE . '.mp4', 'poster' => self::CODE . '.jpg']);
    }

    public function test_a_video_post_resolves_image_data_from_its_poster_not_its_file(): void {
        $this->putSize('original');
        $this->putSize('800');
        $this->putSize('300');

        $data = $this->service()->imageData($this->videoPost());

        $this->assertSame($this->urlFor('original'), $data['original']);
        $this->assertSame($this->urlFor('800'), $data['default']);
        $this->assertSame([800, 300], array_column($data['sizes'], 'width'));
    }

    public function test_a_video_post_without_a_poster_returns_empty_image_data(): void {
        $data = $this->service()->imageData(new Trashpost(['type' => 'video', 'file' => self::CODE . '.mp4', 'poster' => null]));

        $this->assertSame(['original' => null, 'default' => null, 'sizes' => []], $data);
    }
}
