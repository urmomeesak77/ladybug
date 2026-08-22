<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\ImageFile;
use PHPUnit\Framework\TestCase;

class ImageFileTest extends TestCase {
    private string $dir;

    protected function setUp(): void {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/imagefile_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
        parent::tearDown();
    }

    private function makeJpeg(string $name, int $w, int $h): string {
        return $this->makeImage($name, $w, $h, 'imagejpeg');
    }

    private function makeImage(string $name, int $w, int $h, callable $writer): string {
        $path = "{$this->dir}/{$name}";
        $img = imagecreatetruecolor($w, $h);
        $writer($img, $path);
        imagedestroy($img);

        return $path;
    }

    public function test_dimensions_reports_width_and_height(): void {
        $path = $this->makeJpeg('a.jpg', 120, 90);
        $this->assertSame([120, 90], (new ImageFile())->dimensions($path));
    }

    public function test_mime_reports_image_type(): void {
        $path = $this->makeJpeg('a.jpg', 10, 10);
        $this->assertSame('image/jpeg', (new ImageFile())->mime($path));
    }

    public function test_scaled_down_copy_creates_a_narrower_image(): void {
        $src = $this->makeJpeg('src.jpg', 1000, 500);
        $dest = "{$this->dir}/dest.jpg";

        $result = (new ImageFile())->scaledDownCopy($src, $dest, 300);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        $this->assertSame([300, 150], (new ImageFile())->dimensions($dest));
    }

    public function test_scaled_down_copy_skips_when_source_not_wider(): void {
        $src = $this->makeJpeg('src.jpg', 200, 100);
        $dest = "{$this->dir}/dest.jpg";

        $result = (new ImageFile())->scaledDownCopy($src, $dest, 300);

        $this->assertFalse($result);
        $this->assertFileDoesNotExist($dest);
    }

    public function test_scaled_down_copy_handles_png(): void {
        $src = $this->makeImage('src.png', 1000, 500, 'imagepng');
        $dest = "{$this->dir}/dest.png";

        $this->assertTrue((new ImageFile())->scaledDownCopy($src, $dest, 200));
        $this->assertSame([200, 100], (new ImageFile())->dimensions($dest));
    }

    public function test_scaled_down_copy_handles_gif(): void {
        $src = $this->makeImage('src.gif', 800, 400, 'imagegif');
        $dest = "{$this->dir}/dest.gif";

        $this->assertTrue((new ImageFile())->scaledDownCopy($src, $dest, 200));
        $this->assertSame([200, 100], (new ImageFile())->dimensions($dest));
    }

    public function test_scaled_down_copy_handles_static_webp(): void {
        // Static WebP flows through the GD path (imagecreatefromwebp / imagewebp), same as the
        // other formats — only animated WebP needs ImageMagick (App\Support\WebpFile).
        $src = $this->makeImage('src.webp', 1000, 500, 'imagewebp');
        $dest = "{$this->dir}/dest.webp";

        $this->assertTrue((new ImageFile())->scaledDownCopy($src, $dest, 200));
        $this->assertSame([200, 100], (new ImageFile())->dimensions($dest));
        $this->assertSame('image/webp', (new ImageFile())->mime($dest));
    }

    public function test_scaled_down_copy_throws_when_the_destination_is_unwritable(): void {
        $src = $this->makeJpeg('src.jpg', 1000, 500);
        // Parent directory does not exist, so the GD write fails — must surface, not swallow.
        $this->expectException(\RuntimeException::class);
        (new ImageFile())->scaledDownCopy($src, "{$this->dir}/missing/dest.jpg", 300);
    }

    public function test_mime_falls_back_for_a_non_image_file(): void {
        $path = "{$this->dir}/notes.txt";
        file_put_contents($path, 'not an image');
        $this->assertSame('application/octet-stream', (new ImageFile())->mime($path));
    }

    public function test_dimensions_throws_for_an_unreadable_file(): void {
        $path = "{$this->dir}/notes.txt";
        file_put_contents($path, 'not an image');
        $this->expectException(\RuntimeException::class);
        (new ImageFile())->dimensions($path);
    }

    /** A PNG whose whole canvas is fully transparent, for the alpha-flattening tests. */
    private function makeTransparentPng(string $name, int $w, int $h): string {
        $path = "{$this->dir}/{$name}";
        $img = imagecreatetruecolor($w, $h);
        imagealphablending($img, false);
        imagesavealpha($img, true);
        imagefill($img, 0, 0, (int) imagecolorallocatealpha($img, 0, 0, 0, 127));
        imagepng($img, $path);
        imagedestroy($img);

        return $path;
    }

    /** @return array{0: int, 1: int, 2: int} [r, g, b] of one pixel */
    private function pixel(string $path, int $x, int $y): array {
        $img = imagecreatefromjpeg($path);
        $rgb = imagecolorat($img, $x, $y);
        imagedestroy($img);

        return [($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF];
    }

    public function test_copy_as_jpeg_converts_webp_at_the_same_dimensions(): void {
        $src = $this->makeImage('src.webp', 300, 270, 'imagewebp');
        $dest = "{$this->dir}/dest.jpg";

        (new ImageFile())->copyAsJpeg($src, $dest);

        $this->assertSame('image/jpeg', (new ImageFile())->mime($dest));
        $this->assertSame([300, 270], (new ImageFile())->dimensions($dest));
    }

    public function test_copy_as_jpeg_converts_gif(): void {
        $src = $this->makeImage('src.gif', 120, 90, 'imagegif');
        $dest = "{$this->dir}/dest.jpg";

        (new ImageFile())->copyAsJpeg($src, $dest);

        $this->assertSame('image/jpeg', (new ImageFile())->mime($dest));
        $this->assertSame([120, 90], (new ImageFile())->dimensions($dest));
    }

    public function test_copy_as_jpeg_passes_a_jpeg_source_through(): void {
        $src = $this->makeJpeg('src.jpg', 64, 48);
        $dest = "{$this->dir}/dest.jpg";

        (new ImageFile())->copyAsJpeg($src, $dest);

        $this->assertSame('image/jpeg', (new ImageFile())->mime($dest));
        $this->assertSame([64, 48], (new ImageFile())->dimensions($dest));
    }

    public function test_copy_as_jpeg_flattens_transparency_onto_white(): void {
        // JPEG carries no alpha channel. Without an explicit opaque backing, GD writes
        // the transparent pixels as BLACK, which is what turns a logo on a clear
        // background into a black slab in the unfurl card.
        $src = $this->makeTransparentPng('src.png', 40, 40);
        $dest = "{$this->dir}/dest.jpg";

        (new ImageFile())->copyAsJpeg($src, $dest);

        [$r, $g, $b] = $this->pixel($dest, 20, 20);
        // JPEG is lossy, so assert "essentially white" rather than exactly 255.
        $this->assertGreaterThan(245, min($r, $g, $b));
    }

    public function test_copy_as_jpeg_throws_when_the_source_is_unreadable(): void {
        $path = "{$this->dir}/notes.jpg";
        file_put_contents($path, 'not an image');
        $this->expectException(\RuntimeException::class);
        (new ImageFile())->copyAsJpeg($path, "{$this->dir}/dest.jpg");
    }
}
