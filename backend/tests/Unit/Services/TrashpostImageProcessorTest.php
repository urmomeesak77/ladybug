<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Services\TrashpostImageProcessor;
use App\Support\GifFile;
use App\Support\ImageFile;
use App\Support\MediaPath;
use App\Support\WebpFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

class TrashpostImageProcessorTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    private function image(string $name, int $w, int $h): UploadedFile {
        // UploadedFile::fake()->image() draws a real GD image of the given size.
        return UploadedFile::fake()->image($name, $w, $h);
    }

    /** A real 400px-wide WebP fixture (static or animated) presented as an upload. */
    private function webpUpload(string $fixture): UploadedFile {
        $tmp = tempnam(sys_get_temp_dir(), 'webp');
        copy(dirname(__DIR__, 2) . "/fixtures/{$fixture}", $tmp);

        return new UploadedFile($tmp, $fixture, 'image/webp', null, true);
    }

    public function test_stores_original_and_returns_row_fields(): void {
        $result = (new TrashpostImageProcessor())->process($this->image('m.jpg', 1200, 600), 'abc1234567');

        $this->assertSame('abc1234567.jpg', $result['file']);
        $this->assertSame('image', $result['type']);
        Storage::disk('public')->assertExists(MediaPath::imageRelativePath('original', 'abc1234567', 'jpg'));
    }

    public function test_discard_removes_the_original_and_every_variant(): void {
        $file = $this->image('m.jpg', 1200, 600);
        $processor = new TrashpostImageProcessor();
        $processor->process($file, 'abc1234567');

        $processor->discard('abc1234567', $file);

        $disk = Storage::disk('public');
        foreach (MediaPath::imageSizes() as $size) {
            $disk->assertMissing(MediaPath::imageRelativePath($size, 'abc1234567', 'jpg'));
        }
    }

    public function test_generates_variants_narrower_than_the_original(): void {
        (new TrashpostImageProcessor())->process($this->image('m.jpg', 1200, 600), 'abc1234567');

        $disk = Storage::disk('public');
        // 800/500/300/100 are all < 1200, so all exist.
        $disk->assertExists(MediaPath::imageRelativePath('800', 'abc1234567', 'jpg'));
        $disk->assertExists(MediaPath::imageRelativePath('100', 'abc1234567', 'jpg'));
    }

    public function test_does_not_upscale_beyond_original_width(): void {
        (new TrashpostImageProcessor())->process($this->image('m.jpg', 400, 200), 'abc1234567');

        $disk = Storage::disk('public');
        // Original is 400 wide: 800 and 500 are skipped; 300 and 100 are made.
        $disk->assertMissing(MediaPath::imageRelativePath('800', 'abc1234567', 'jpg'));
        $disk->assertExists(MediaPath::imageRelativePath('300', 'abc1234567', 'jpg'));
    }

    public function test_generates_gif_variants(): void {
        (new TrashpostImageProcessor())->process($this->image('m.gif', 1200, 600), 'abc1234567');

        $disk = Storage::disk('public');
        $disk->assertExists(MediaPath::imageRelativePath('original', 'abc1234567', 'gif'));
        // GIF variants are made by gifsicle (not GD) so animation frames survive.
        $disk->assertExists(MediaPath::imageRelativePath('800', 'abc1234567', 'gif'));
        $disk->assertExists(MediaPath::imageRelativePath('100', 'abc1234567', 'gif'));
    }

    public function test_maps_webp_mime_to_a_webp_extension(): void {
        $result = (new TrashpostImageProcessor())->process($this->webpUpload('static.webp'), 'abc1234567');

        $this->assertSame('abc1234567.webp', $result['file']);
        Storage::disk('public')->assertExists(MediaPath::imageRelativePath('original', 'abc1234567', 'webp'));
    }

    public function test_routes_a_static_webp_through_gd_not_imagemagick(): void {
        // A static WebP resizes fine in GD; ImageMagick (WebpFile) is reserved for animation.
        $webp = Mockery::mock(WebpFile::class);
        $webp->shouldReceive('isAnimated')->andReturnFalse();
        $webp->shouldNotReceive('scaledDownCopy');
        $processor = new TrashpostImageProcessor(new ImageFile(), new GifFile(), $webp);

        $processor->process($this->webpUpload('static.webp'), 'abc1234567');

        // The GD path produced the narrower variant (fixture is 400px wide, so 100 exists).
        Storage::disk('public')->assertExists(MediaPath::imageRelativePath('100', 'abc1234567', 'webp'));
    }

    public function test_routes_an_animated_webp_through_imagemagick(): void {
        // Animated WebP must go to WebpFile so frames survive; assert it is the resizer invoked.
        $webp = Mockery::mock(WebpFile::class);
        $webp->shouldReceive('isAnimated')->andReturnTrue();
        $webp->shouldReceive('scaledDownCopy')->andReturnTrue();
        $processor = new TrashpostImageProcessor(new ImageFile(), new GifFile(), $webp);

        $processor->process($this->webpUpload('animated.webp'), 'abc1234567');

        $webp->shouldHaveReceived('scaledDownCopy');
    }

    public function test_extension_is_derived_from_content_not_the_client_filename(): void {
        // Principle VI: a real PNG uploaded under a deceptive .php name must be stored with a
        // safe, content-derived extension — never the attacker-controlled client extension.
        $tmp = tempnam(sys_get_temp_dir(), 'up');
        $img = imagecreatetruecolor(50, 50);
        imagepng($img, $tmp);
        imagedestroy($img);
        $file = new UploadedFile($tmp, 'evil.php', 'image/png', null, true);

        $result = (new TrashpostImageProcessor())->process($file, 'abc1234567');

        $this->assertSame('abc1234567.png', $result['file']);
        Storage::disk('public')->assertExists(MediaPath::imageRelativePath('original', 'abc1234567', 'png'));
        Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('original', 'abc1234567', 'php'));
    }

    public function test_metadata_carries_dimensions_ratio_and_mime(): void {
        $result = (new TrashpostImageProcessor())->process($this->image('m.jpg', 1200, 600), 'abc1234567');

        $meta = json_decode($result['metadata'], true);
        $this->assertSame(1200, $meta['width']);
        $this->assertSame(600, $meta['height']);
        // json_decode renders a whole-number ratio as int; compare numerically.
        $this->assertEqualsWithDelta(2.0, $meta['ratio'], 0.0001);
        $this->assertSame('image/jpeg', $meta['mime']);
    }
}
