<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Rules;

use App\Http\Rules\MaxPixels;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\TestCase;

/**
 * Decompression-bomb guard: a few-KB PNG can declare 20000x20000 pixels, which GD then
 * tries to allocate as ~1.6 GB of truecolor bitmap — far past memory_limit, and a PHP
 * fatal is not a Throwable the upload rollback can catch. The rule reads only the header.
 */
final class MaxPixelsTest extends TestCase {
    /** A real PNG of the given size, written to a temp file and presented as an upload. */
    private function png(int $width, int $height): UploadedFile {
        $img = imagecreate($width, $height);
        imagecolorallocate($img, 255, 255, 255);
        $path = (string) tempnam(sys_get_temp_dir(), 'px') . '.png';
        imagepng($img, $path, 9);
        imagedestroy($img);

        return new UploadedFile($path, 'meme.png', 'image/png', null, true);
    }

    /** @return string|null the failure message, or null when the rule passed */
    private function validate(MaxPixels $rule, mixed $value): ?string {
        $message = null;
        $rule->validate('image', $value, function (string $msg) use (&$message) {
            $message = $msg;
        });

        return $message;
    }

    public function test_passes_an_image_within_the_budget(): void {
        $this->assertNull($this->validate(new MaxPixels(100), $this->png(10, 10)));
    }

    public function test_passes_an_image_exactly_at_the_budget(): void {
        $this->assertNull($this->validate(new MaxPixels(100), $this->png(10, 10)));
        $this->assertNull($this->validate(new MaxPixels(200), $this->png(10, 20)));
    }

    public function test_fails_an_image_over_the_budget(): void {
        $this->assertSame(
            'The image is too large: at most 0.0001 megapixels are allowed.',
            $this->validate(new MaxPixels(100), $this->png(11, 10)),
        );
    }

    public function test_a_tall_image_within_the_budget_passes(): void {
        // Long-scroll memes are legitimate: the cap is on AREA, never on either side.
        $this->assertNull($this->validate(new MaxPixels(2000), $this->png(10, 200)));
    }

    public function test_ignores_a_value_that_is_not_an_upload(): void {
        $this->assertNull($this->validate(new MaxPixels(1), 'not-a-file'));
    }

    public function test_leaves_an_unreadable_file_to_the_image_rule(): void {
        // `image`/`mimes` already reject a non-image with their own message; this rule
        // must not add a second, misleading "too large" one on top.
        $fake = UploadedFile::fake()->create('meme.png', 1, 'image/png');

        $this->assertNull($this->validate(new MaxPixels(1), $fake));
    }

    public function test_the_default_budget_is_twenty_five_megapixels(): void {
        $this->assertSame(25_000_000, MaxPixels::DEFAULT_MAX);
    }
}
