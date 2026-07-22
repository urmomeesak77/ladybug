<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Support\MediaPath;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class BackfillVariantsCommandTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    /** Put a real GD-drawn original of the given width at its canonical path. */
    private function putOriginal(string $code, int $width): void {
        $rel = MediaPath::imageRelativePath('original', $code, 'jpg');
        $file = UploadedFile::fake()->image("{$code}.jpg", $width, (int) ($width / 2));
        Storage::disk('public')->putFileAs(dirname($rel), $file, basename($rel));
    }

    public function test_it_generates_missing_variants_for_existing_originals(): void {
        $this->putOriginal('wideimage0', 1600);

        $exit = Artisan::call('media:backfill-variants');

        $this->assertSame(0, $exit);
        $disk = Storage::disk('public');
        $disk->assertExists(MediaPath::imageRelativePath('1200', 'wideimage0', 'jpg'));
        $disk->assertExists(MediaPath::imageRelativePath('800', 'wideimage0', 'jpg'));
    }

    public function test_it_never_upscales_a_narrow_original(): void {
        $this->putOriginal('narrowimg0', 900);

        Artisan::call('media:backfill-variants');

        // 900 < 1200, so no 1200 variant is created.
        Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('1200', 'narrowimg0', 'jpg'));
    }

    public function test_re_running_is_idempotent(): void {
        $this->putOriginal('wideimage0', 1600);
        Artisan::call('media:backfill-variants');

        $exit = Artisan::call('media:backfill-variants');
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('variants written: 0', $output);
    }

    public function test_dry_run_writes_nothing(): void {
        $this->putOriginal('wideimage0', 1600);

        $exit = Artisan::call('media:backfill-variants', ['--dry-run' => true]);

        $this->assertSame(0, $exit);
        Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('1200', 'wideimage0', 'jpg'));
    }
}
