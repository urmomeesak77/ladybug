<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class SeedMediaCommandTest extends TestCase
{
    private string $source;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->source = $this->makeFixtureSource();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->source);
        parent::tearDown();
    }

    /**
     * Build a small prototype-shaped source tree: a few sizes/shards, mixed
     * jpg/jpeg/png/gif, plus stray .gitignore and a stray non-media file.
     */
    private function makeFixtureSource(): string
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'media-seed-' . uniqid();

        $files = [
            'original/1/1abc.jpg' => 'orig-1abc',
            'original/a/abc.png' => 'orig-abc',
            'original/other/-dash.gif' => 'orig-dash',
            '300/1/1abc.jpg' => 'small-1abc',
            '100/a/abc.jpeg' => 'tiny-abc',
            // strays that must never be copied and must be counted as straySkipped:
            'original/.gitignore' => '*',
            '300/.gitignore' => '*',
            '100/.gitignore' => '*',
            'original/1/notes.txt' => 'not media',
        ];

        foreach ($files as $relative => $contents) {
            $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
            File::ensureDirectoryExists(dirname($path));
            File::put($path, $contents);
        }

        return $root;
    }

    public function test_it_copies_media_into_the_canonical_layout(): void
    {
        $exit = Artisan::call('media:seed', ['--source' => $this->source]);
        $disk = Storage::disk('public');

        $this->assertSame(0, $exit);
        $disk->assertExists('image/trash/original/1/1abc.jpg');
        $disk->assertExists('image/trash/original/a/abc.png');
        $disk->assertExists('image/trash/original/other/-dash.gif');
        $disk->assertExists('image/trash/300/1/1abc.jpg');
        $disk->assertExists('image/trash/100/a/abc.jpeg');
        $this->assertSame('orig-1abc', $disk->get('image/trash/original/1/1abc.jpg'));
        $this->assertSame('tiny-abc', $disk->get('image/trash/100/a/abc.jpeg'));
    }

    public function test_it_never_copies_stray_non_media_files(): void
    {
        Artisan::call('media:seed', ['--source' => $this->source]);
        $disk = Storage::disk('public');

        foreach ($disk->allFiles('image/trash') as $copied) {
            $this->assertStringEndsNotWith('.gitignore', $copied);
            $this->assertStringEndsNotWith('.txt', $copied);
        }

        $output = Artisan::output();
        $this->assertStringContainsString('stray skipped (source): 4', $output);
    }

    public function test_dry_run_writes_nothing_but_still_reports(): void
    {
        $exit = Artisan::call('media:seed', ['--source' => $this->source, '--dry-run' => true]);
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertEmpty(Storage::disk('public')->allFiles('image/trash'));
        $this->assertStringContainsString('RESULT: OK', $output);
        $this->assertStringContainsString('stray skipped (source): 4', $output);
    }

    public function test_re_running_is_idempotent(): void
    {
        Artisan::call('media:seed', ['--source' => $this->source]);

        $exit = Artisan::call('media:seed', ['--source' => $this->source]);
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('copied: 0', $output);
        $this->assertStringContainsString('RESULT: OK', $output);
    }

    public function test_report_shows_per_size_match_and_clean_verification(): void
    {
        $exit = Artisan::call('media:seed', ['--source' => $this->source]);
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('checksum mismatches: 0', $output);
        $this->assertStringContainsString('stray files in destination: 0', $output);
        $this->assertStringContainsString('RESULT: OK', $output);
        // original has 3 media files in the fixture; the report must show them matched.
        $this->assertMatchesRegularExpression('/original\s+3\s+3\s+OK/', $output);
    }

    public function test_missing_source_errors_and_exits_nonzero(): void
    {
        $missing = $this->source . DIRECTORY_SEPARATOR . 'does-not-exist';

        $exit = Artisan::call('media:seed', ['--source' => $missing]);
        $output = Artisan::output();

        $this->assertSame(1, $exit);
        $this->assertStringContainsString('not', strtolower($output));
        $this->assertEmpty(Storage::disk('public')->allFiles('image/trash'));
    }
}
