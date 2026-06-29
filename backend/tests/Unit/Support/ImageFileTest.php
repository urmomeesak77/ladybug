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
}
