<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Services\TrashpostVideoProcessor;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The video upload write path: store the video, extract+store its poster (reusing the
 * image size-variant pipeline, research.md #4), and roll back everything on failure.
 */
final class TrashpostVideoProcessorTest extends TestCase {
    use RefreshDatabase;

    private string $fixtures;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        $this->fixtures = dirname(__DIR__, 2) . '/fixtures';
    }

    /** A real fixture presented as an upload, without the isValid() test-mode restriction. */
    private function fixtureUpload(string $fixture, string $mime): UploadedFile {
        return new UploadedFile("{$this->fixtures}/{$fixture}", $fixture, $mime, null, true);
    }

    public function test_process_stores_the_mp4_and_its_poster_variants(): void {
        $processor = new TrashpostVideoProcessor();
        $upload = $this->fixtureUpload('sample.mp4', 'video/mp4');

        $result = $processor->process($upload, 'abc123hash');

        $this->assertSame('abc123hash.mp4', $result['file']);
        $this->assertSame('video', $result['type']);
        $this->assertSame('abc123hash.jpg', $result['poster']);

        $disk = Storage::disk('public');
        $disk->assertExists(MediaPath::videoRelativePath('abc123hash', 'mp4'));
        $posterOriginal = MediaPath::imageRelativePath('original', 'abc123hash', 'jpg');
        $disk->assertExists($posterOriginal);
        $this->assertNotFalse(getimagesize($disk->path($posterOriginal)));

        // Every narrower variant that the poster's own width allows must exist too, and
        // must never be wider than the source poster frame (never-upscale rule).
        [$sourceWidth] = getimagesize($disk->path($posterOriginal));
        foreach (MediaPath::imageSizes() as $size) {
            if ($size === 'original') {
                continue;
            }
            $variantPath = MediaPath::imageRelativePath($size, 'abc123hash', 'jpg');
            if ((int) $size >= $sourceWidth) {
                $disk->assertMissing($variantPath);

                continue;
            }
            $disk->assertExists($variantPath);
            [$variantWidth] = getimagesize($disk->path($variantPath));
            $this->assertLessThanOrEqual($sourceWidth, $variantWidth);
        }
    }

    public function test_process_stores_the_webm_and_its_poster(): void {
        $processor = new TrashpostVideoProcessor();
        $upload = $this->fixtureUpload('sample.webm', 'video/webm');

        $result = $processor->process($upload, 'xyz789hash');

        $this->assertSame('xyz789hash.webm', $result['file']);
        $this->assertSame('video', $result['type']);
        $this->assertSame('xyz789hash.jpg', $result['poster']);
        Storage::disk('public')->assertExists(MediaPath::videoRelativePath('xyz789hash', 'webm'));
        Storage::disk('public')->assertExists(MediaPath::imageRelativePath('original', 'xyz789hash', 'jpg'));
    }

    public function test_process_returns_metadata_with_positive_dimensions_and_video_mime(): void {
        $processor = new TrashpostVideoProcessor();
        $upload = $this->fixtureUpload('sample.mp4', 'video/mp4');

        $result = $processor->process($upload, 'metahash01');
        $metadata = json_decode($result['metadata'], true);

        $this->assertGreaterThan(0, $metadata['width']);
        $this->assertGreaterThan(0, $metadata['height']);
        $this->assertSame('video/mp4', $metadata['mime']);
    }

    public function test_discard_removes_the_video_and_every_poster_variant(): void {
        $processor = new TrashpostVideoProcessor();
        $upload = $this->fixtureUpload('sample.mp4', 'video/mp4');
        $processor->process($upload, 'discardme');

        $processor->discard('discardme', $upload);

        $disk = Storage::disk('public');
        $disk->assertMissing(MediaPath::videoRelativePath('discardme', 'mp4'));
        foreach (MediaPath::imageSizes() as $size) {
            $disk->assertMissing(MediaPath::imageRelativePath($size, 'discardme', 'jpg'));
        }
    }
}
