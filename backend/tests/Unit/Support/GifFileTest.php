<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\GifFile;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Process\Process;

class GifFileTest extends TestCase {
    private string $dir;

    protected function setUp(): void {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/giffile_' . uniqid();
        mkdir($this->dir);
    }

    protected function tearDown(): void {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
        parent::tearDown();
    }

    /**
     * A real two-frame animated GIF: two GD-drawn frames merged by gifsicle itself —
     * the same binary under test, but exercised through its documented merge mode
     * rather than the resize path GifFile wraps.
     */
    private function makeAnimatedGif(string $name, int $w, int $h): string {
        $frames = [];
        foreach ([0x3366FF, 0xFF6633] as $i => $rgb) {
            $framePath = "{$this->dir}/frame{$i}.gif";
            $img = imagecreatetruecolor($w, $h);
            imagefill($img, 0, 0, $rgb);
            imagegif($img, $framePath);
            imagedestroy($img);
            $frames[] = $framePath;
        }

        $path = "{$this->dir}/{$name}";
        $process = new Process(array_merge(['gifsicle', '--delay', '10'], $frames, ['-o', $path]));
        $process->run();
        if (!$process->isSuccessful()) {
            throw new \RuntimeException('Fixture build failed: ' . $process->getErrorOutput());
        }

        return $path;
    }

    /**
     * A GIF whose second frame is shifted so left + width overruns the logical screen.
     * Real uploads like this crash gifsicle's plain --resize-width with an xform.c
     * assertion (exit 134), which scaledDownCopy must survive via its fallback.
     */
    private function makeFrameOverrunGif(string $name, int $w, int $h): string {
        $path = $this->makeAnimatedGif($name, $w, $h);
        $bytes = (string) file_get_contents($path);
        // Image descriptor: 0x2C, left(2), top(2), width(2), height(2) — all LE.
        $descriptor = "\x2C\x00\x00\x00\x00" . pack('v', $w) . pack('v', $h);
        $first = strpos($bytes, $descriptor);
        $second = $first === false ? false : strpos($bytes, $descriptor, $first + 1);
        if ($second === false) {
            throw new \RuntimeException('Fixture build failed: frame descriptors not found');
        }
        $bytes = substr_replace($bytes, pack('v', $w - 100), $second + 1, 2);
        file_put_contents($path, $bytes);

        return $path;
    }

    private function frameReport(string $path): string {
        $process = new Process(['gifsicle', '--info', $path]);
        $process->run();

        return $process->getOutput();
    }

    public function test_scaled_down_copy_creates_a_narrower_gif(): void {
        $src = $this->makeAnimatedGif('src.gif', 1000, 500);
        $dest = "{$this->dir}/dest.gif";

        $result = (new GifFile())->scaledDownCopy($src, $dest, 300);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        $this->assertSame([300, 150], array_slice((array) getimagesize($dest), 0, 2));
    }

    public function test_scaled_down_copy_preserves_every_animation_frame(): void {
        $src = $this->makeAnimatedGif('src.gif', 1000, 500);
        $dest = "{$this->dir}/dest.gif";

        (new GifFile())->scaledDownCopy($src, $dest, 300);

        $this->assertStringContainsString('2 images', $this->frameReport($dest));
    }

    public function test_scaled_down_copy_rescues_a_gif_whose_frames_overrun_the_screen(): void {
        $src = $this->makeFrameOverrunGif('src.gif', 400, 200);
        $dest = "{$this->dir}/dest.gif";

        $result = (new GifFile())->scaledDownCopy($src, $dest, 100);

        $this->assertTrue($result);
        $this->assertStringContainsString('2 images', $this->frameReport($dest));
    }

    public function test_scaled_down_copy_skips_when_source_not_wider(): void {
        $src = $this->makeAnimatedGif('src.gif', 200, 100);
        $dest = "{$this->dir}/dest.gif";

        $result = (new GifFile())->scaledDownCopy($src, $dest, 300);

        $this->assertFalse($result);
        $this->assertFileDoesNotExist($dest);
    }

    public function test_scaled_down_copy_throws_when_the_destination_is_unwritable(): void {
        $src = $this->makeAnimatedGif('src.gif', 1000, 500);
        // Parent directory does not exist — must surface loudly, never point the feed
        // at a variant that was silently not written.
        $this->expectException(\RuntimeException::class);
        (new GifFile())->scaledDownCopy($src, "{$this->dir}/missing/dest.gif", 300);
    }

    public function test_scaled_down_copy_throws_for_an_unreadable_source(): void {
        $path = "{$this->dir}/notes.gif";
        file_put_contents($path, 'not a gif, just plain text bytes');
        $this->expectException(\RuntimeException::class);
        (new GifFile())->scaledDownCopy($path, "{$this->dir}/dest.gif", 300);
    }
}
