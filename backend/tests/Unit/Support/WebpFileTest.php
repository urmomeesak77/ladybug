<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WebpFile;
use PHPUnit\Framework\TestCase;

class WebpFileTest extends TestCase {
    private string $dir;

    private string $staticFixture;

    private string $animatedFixture;

    protected function setUp(): void {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/webpfile_' . uniqid();
        mkdir($this->dir);
        // Committed fixtures: a single-frame WebP and a 3-frame animated WebP (tests/fixtures).
        $fixtures = dirname(__DIR__, 2) . '/fixtures';
        $this->staticFixture = "{$fixtures}/static.webp";
        $this->animatedFixture = "{$fixtures}/animated.webp";
    }

    protected function tearDown(): void {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
        parent::tearDown();
    }

    /** Animated WebP is a chain of ANMF chunks; counting them counts the frames. */
    private function frameCount(string $path): int {
        return substr_count((string) file_get_contents($path), 'ANMF');
    }

    public function test_is_animated_is_false_for_a_static_webp(): void {
        $this->assertFalse((new WebpFile())->isAnimated($this->staticFixture));
    }

    public function test_is_animated_is_true_for_an_animated_webp(): void {
        $this->assertTrue((new WebpFile())->isAnimated($this->animatedFixture));
    }

    public function test_scaled_down_copy_preserves_animation_frames(): void {
        $dest = "{$this->dir}/dest.webp";

        $result = (new WebpFile())->scaledDownCopy($this->animatedFixture, $dest, 100);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        // The whole point of ImageMagick over GD here: every frame survives the resize.
        $this->assertGreaterThan(1, $this->frameCount($dest));
        $this->assertSame(100, getimagesize($dest)[0]);
    }

    public function test_scaled_down_copy_skips_when_source_not_wider(): void {
        $dest = "{$this->dir}/dest.webp";

        // The animated fixture is 400px wide; a 500px target is an upscale we never perform.
        $result = (new WebpFile())->scaledDownCopy($this->animatedFixture, $dest, 500);

        $this->assertFalse($result);
        $this->assertFileDoesNotExist($dest);
    }

    public function test_scaled_down_copy_throws_when_the_destination_is_unwritable(): void {
        // Parent directory does not exist — the write must surface, not be swallowed.
        $this->expectException(\RuntimeException::class);
        (new WebpFile())->scaledDownCopy($this->animatedFixture, "{$this->dir}/missing/dest.webp", 100);
    }

    public function test_first_frame_as_jpeg_writes_a_single_frame_jpeg(): void {
        // GD cannot decode an animated WebP at all — imagecreatefromwebp() fails with
        // "gd-webp cannot allocate temporary buffer" — so the unfurl preview for one
        // has to come through ImageMagick, exactly as the resize does.
        $dest = "{$this->dir}/dest.jpg";

        (new WebpFile())->firstFrameAsJpeg($this->animatedFixture, $dest);

        $this->assertFileExists($dest);
        $info = getimagesize($dest);
        $this->assertNotFalse($info);
        $this->assertSame('image/jpeg', $info['mime']);
    }

    public function test_first_frame_as_jpeg_keeps_the_sources_dimensions(): void {
        $dest = "{$this->dir}/dest.jpg";
        $expected = getimagesize($this->animatedFixture);

        (new WebpFile())->firstFrameAsJpeg($this->animatedFixture, $dest);

        $this->assertSame([$expected[0], $expected[1]], array_slice((array) getimagesize($dest), 0, 2));
    }

    public function test_first_frame_as_jpeg_throws_when_the_source_is_unreadable(): void {
        $path = "{$this->dir}/notes.webp";
        file_put_contents($path, 'not a webp');
        $this->expectException(\RuntimeException::class);
        (new WebpFile())->firstFrameAsJpeg($path, "{$this->dir}/dest.jpg");
    }

    public function test_is_animated_is_false_for_a_path_that_does_not_exist(): void {
        // Silently false, not a warning: callers ask this about a path they are ABOUT to
        // read, and a missing file is "not an animation" like any other non-WebP.
        $this->assertFalse((new WebpFile())->isAnimated("{$this->dir}/nothing-here.webp"));
    }

    public function test_first_frame_as_jpeg_throws_when_the_destination_is_unwritable(): void {
        // Valid source, impossible destination: `convert` fails and the failure must
        // surface, never leave the caller thinking a preview was written.
        $this->expectException(\RuntimeException::class);
        (new WebpFile())->firstFrameAsJpeg($this->animatedFixture, "{$this->dir}/missing/dest.jpg");
    }
}
