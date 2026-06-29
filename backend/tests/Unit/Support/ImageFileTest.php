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
        $path = "{$this->dir}/{$name}";
        $img = imagecreatetruecolor($w, $h);
        imagejpeg($img, $path);
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
}
