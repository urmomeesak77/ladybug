<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\OgImageService;
use App\Support\MediaPath;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class OgImageServiceTest extends TestCase {
    private const HASH = 'VlP6045I0d';

    private const CODE = 'VlP6045I0d';

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    private function service(): OgImageService {
        return app(OgImageService::class);
    }

    /** Real encoded bytes, so the transcode has something GD can actually decode. */
    private function imageBytes(int $width, int $height, string $format): string {
        $img = imagecreatetruecolor($width, $height);
        ob_start();
        $format === 'webp' ? imagewebp($img) : imagejpeg($img);
        $bytes = (string) ob_get_clean();
        imagedestroy($img);

        return $bytes;
    }

    private function imagePost(string $ext = 'webp'): Trashpost {
        $post = new Trashpost(['file' => self::CODE . '.' . $ext]);
        $post->hash = self::HASH;

        return $post;
    }

    private function putVariant(string $size, int $width, int $height, string $ext = 'webp'): void {
        Storage::disk('public')->put(
            MediaPath::imageRelativePath($size, self::CODE, $ext),
            $this->imageBytes($width, $height, $ext),
        );
    }

    /** @return array{0: int, 1: int} [width, height] of the file on the fake disk */
    private function sizeOf(string $rel): array {
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $info = getimagesize($disk->path($rel));
        self::assertNotFalse($info, "Not a readable image: {$rel}");

        return [$info[0], $info[1]];
    }

    public function test_ensure_writes_a_jpeg_at_the_og_path(): void {
        $this->putVariant('300', 300, 270);

        $rel = $this->service()->ensure($this->imagePost());

        $this->assertSame(MediaPath::ogRelativePath(self::HASH), $rel);
        Storage::disk('public')->assertExists($rel);
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame('image/jpeg', (string) getimagesize($disk->path($rel))['mime']);
    }

    public function test_ensure_keeps_the_sources_dimensions(): void {
        $this->putVariant('300', 300, 270);

        $rel = $this->service()->ensure($this->imagePost());

        $this->assertSame([300, 270], $this->sizeOf((string) $rel));
    }

    public function test_ensure_transcodes_from_the_widest_variant(): void {
        $this->putVariant('100', 100, 100);
        $this->putVariant('500', 500, 500);

        $rel = $this->service()->ensure($this->imagePost());

        $this->assertSame([500, 500], $this->sizeOf((string) $rel));
    }

    public function test_ensure_reuses_the_cached_file_instead_of_regenerating(): void {
        // A sentinel at the destination: if ensure() re-ran the transcode it would be
        // overwritten with real JPEG bytes. Surviving byte-for-byte is the proof that
        // the second visitor costs no GD work at all.
        $this->putVariant('300', 300, 270);
        $rel = MediaPath::ogRelativePath(self::HASH);
        Storage::disk('public')->put($rel, 'already-generated');

        $this->assertSame($rel, $this->service()->ensure($this->imagePost()));
        $this->assertSame('already-generated', Storage::disk('public')->get($rel));
    }

    public function test_ensure_returns_null_when_the_post_has_no_media_on_disk(): void {
        $this->assertNull($this->service()->ensure($this->imagePost()));
    }

    public function test_ensure_falls_back_to_a_youtube_posts_thumbnail(): void {
        $post = new Trashpost(['type' => 'youtube']);
        $post->hash = self::HASH;
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post->youtube_thumbnail = $thumb;
        Storage::disk('public')->put($thumb, $this->imageBytes(480, 360, 'jpg'));

        $rel = $this->service()->ensure($post);

        $this->assertSame(MediaPath::ogRelativePath(self::HASH), $rel);
        $this->assertSame([480, 360], $this->sizeOf((string) $rel));
    }

    public function test_ensure_returns_null_when_the_youtube_thumbnail_is_missing(): void {
        $post = new Trashpost(['type' => 'youtube']);
        $post->hash = self::HASH;
        $post->youtube_thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');

        $this->assertNull($this->service()->ensure($post));
    }

    public function test_ensure_leaves_no_temporary_file_behind(): void {
        $this->putVariant('300', 300, 270);

        $rel = (string) $this->service()->ensure($this->imagePost());

        $this->assertSame([$rel], Storage::disk('public')->files(dirname($rel)));
    }

    public function test_ensure_transcodes_an_animated_webp(): void {
        // The format the whole feature exists for, and the one GD cannot open at all:
        // imagecreatefromwebp() fails outright on an animation with "gd-webp cannot
        // allocate temporary buffer". Real fixture bytes, not a GD-made stand-in.
        Storage::disk('public')->put(
            MediaPath::imageRelativePath('300', self::CODE, 'webp'),
            (string) file_get_contents(base_path('tests/fixtures/animated.webp')),
        );

        $rel = (string) $this->service()->ensure($this->imagePost());

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame('image/jpeg', (string) getimagesize($disk->path($rel))['mime']);
    }

    public function test_ensure_still_uses_gd_for_a_static_webp(): void {
        Storage::disk('public')->put(
            MediaPath::imageRelativePath('300', self::CODE, 'webp'),
            (string) file_get_contents(base_path('tests/fixtures/static.webp')),
        );

        $rel = (string) $this->service()->ensure($this->imagePost());

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame('image/jpeg', (string) getimagesize($disk->path($rel))['mime']);
    }

    public function test_ensure_prefers_the_original_when_it_is_within_the_width_cap(): void {
        // A 400x200 upload has no variant wider than 300, so the widest DOWNSCALE is
        // 300x150 — under X's 300x157 floor for a large-image card, which would cost the
        // meme the very card this feature exists to restore. The original is small
        // enough to use untouched, so it wins.
        $this->putVariant('original', 400, 200);
        $this->putVariant('300', 300, 150);

        $rel = (string) $this->service()->ensure($this->imagePost());

        $this->assertSame([400, 200], $this->sizeOf($rel));
    }

    public function test_ensure_skips_an_oversized_original_for_the_widest_variant(): void {
        // The other half of the rule: an original far wider than any card needs is not
        // worth the bytes, and X rejects anything over 5 MB outright.
        $this->putVariant('original', 2000, 1000);
        $this->putVariant('1200', 1200, 600);

        $rel = (string) $this->service()->ensure($this->imagePost());

        $this->assertSame([1200, 600], $this->sizeOf($rel));
    }

    public function test_ensure_uses_an_oversized_original_when_it_is_the_only_rendition(): void {
        // Nothing on disk is within the cap, so the cap cannot be honoured — and a card
        // image that is too big still beats no card image at all.
        $this->putVariant('original', 1600, 900);

        $rel = (string) $this->service()->ensure($this->imagePost());

        $this->assertSame([1600, 900], $this->sizeOf($rel));
    }
}
