<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\MediaPath;
use Illuminate\Console\Command;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Finder\SplFileInfo;

/**
 * Seeds the prototype image library into the canonical media tree (contract:
 * specs/003-media-storage/contracts/seed-media-command.md). Copies bytes verbatim,
 * skips non-media strays, runs idempotently, and prints a verification report whose
 * exit code is 0 only when every per-size count matches and nothing is corrupt or stray.
 */
final class SeedMediaCommand extends Command {
    protected $signature = 'media:seed
        {--source= : Absolute path to the prototype image/trash root to copy from}
        {--dry-run : Scan and report what would be copied without writing files}';

    protected $description = 'Copy the prototype image library into storage/app/public/image/trash with a verification report';

    /** Used only when neither --source nor MEDIA_SEED_SOURCE is provided. */
    private const DEFAULT_SOURCE = 'C:\projects\trash\storage\app\public\image\trash';

    public function handle(): int {
        $source = $this->resolveSource();
        if ($source === null) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $disk = Storage::disk('public');

        $plan = $this->copyMedia($source, $disk, $dryRun);
        $report = $this->verify($plan, $disk, $dryRun);
        $this->printReport($source, $report);

        return $report['ok'] ? self::SUCCESS : self::FAILURE;
    }

    /** Resolve --source → media.seed_source config (MEDIA_SEED_SOURCE env) → default; null (with error) if it is not a dir. */
    private function resolveSource(): ?string {
        $source = $this->option('source') ?: config('media.seed_source') ?: self::DEFAULT_SOURCE;

        if (! File::isDirectory($source)) {
            $this->error("Source directory not found: {$source}");

            return null;
        }

        return $source;
    }

    /**
     * Walk the source, copy media verbatim (idempotently), and tally what was seen.
     *
     * @return array{sizeSource: array<string,int>, entries: list<array{dest: string, src: string}>, copied: int, skipped: int, straySkipped: int}
     */
    private function copyMedia(string $source, FilesystemAdapter $disk, bool $dryRun): array {
        $sizeSource = array_fill_keys(MediaPath::imageSizes(), 0);
        $entries = [];
        $copied = $skipped = $straySkipped = 0;

        foreach (File::allFiles($source, true) as $file) {
            $name = $file->getFilename();
            if (! MediaPath::isMediaFile($name)) {
                $straySkipped++; // .gitignore and other control files never enter the tree
                continue;
            }

            $size = $this->sizeSegment($file);
            $dest = MediaPath::imageRelativePath($size, pathinfo($name, PATHINFO_FILENAME), pathinfo($name, PATHINFO_EXTENSION));
            if (array_key_exists($size, $sizeSource)) {
                $sizeSource[$size]++;
            }
            $entries[] = ['dest' => $dest, 'src' => $file->getRealPath()];

            $this->copyOne($disk, $file->getRealPath(), $dest, $dryRun) ? $copied++ : $skipped++;
        }

        return compact('sizeSource', 'entries', 'copied', 'skipped', 'straySkipped');
    }

    /** Copy only when the destination is missing or a different size; returns true if (would be) copied. */
    private function copyOne(FilesystemAdapter $disk, string $srcPath, string $dest, bool $dryRun): bool {
        if ($disk->exists($dest) && $disk->size($dest) === filesize($srcPath)) {
            return false;
        }

        if (! $dryRun) {
            $disk->put($dest, File::get($srcPath));
        }

        return true;
    }

    /** The first path segment under the source root is the size bucket (e.g. original, 300). */
    private function sizeSegment(SplFileInfo $file): string {
        return explode('/', str_replace('\\', '/', $file->getRelativePathname()))[0];
    }

    /**
     * @param  array{sizeSource: array<string,int>, entries: list<array{dest: string, src: string}>, copied: int, skipped: int, straySkipped: int}  $plan
     */
    private function verify(array $plan, FilesystemAdapter $disk, bool $dryRun): array {
        $rows = [];
        $countsMatch = true;
        foreach (MediaPath::imageSizes() as $size) {
            $src = $plan['sizeSource'][$size];
            // Dry-run never writes, so report the planned (source) count as the destination.
            $dest = $dryRun ? $src : count($disk->allFiles("image/trash/{$size}"));
            $countsMatch = $countsMatch && $src === $dest;
            $rows[] = ['size' => $size, 'source' => $src, 'dest' => $dest, 'match' => $src === $dest];
        }

        $mismatches = $dryRun ? 0 : $this->checksumMismatches($plan['entries'], $disk);
        $strayInDest = $dryRun ? 0 : $this->strayInDest($disk);

        return $plan + [
            'rows' => $rows,
            'checksumMismatches' => $mismatches,
            'strayInDest' => $strayInDest,
            'ok' => $countsMatch && $mismatches === 0 && $strayInDest === 0,
        ];
    }

    /**
     * @param  list<array{dest: string, src: string}>  $entries
     */
    private function checksumMismatches(array $entries, FilesystemAdapter $disk): int {
        $mismatches = 0;
        foreach ($entries as $entry) {
            if (! $disk->exists($entry['dest'])
                || hash_file('sha256', $entry['src']) !== hash_file('sha256', $disk->path($entry['dest']))) {
                $mismatches++;
            }
        }

        return $mismatches;
    }

    private function strayInDest(FilesystemAdapter $disk): int {
        $stray = 0;
        foreach ($disk->allFiles('image/trash') as $path) {
            if (! MediaPath::isMediaFile($path)) {
                $stray++;
            }
        }

        return $stray;
    }

    /**
     * @param  array<string, mixed>  $report
     */
    private function printReport(string $source, array $report): void {
        $this->line("Media seed report (source: {$source})");
        $this->line(sprintf('%-10s %7s %7s   %s', 'size', 'source', 'dest', 'match'));
        foreach ($report['rows'] as $row) {
            $this->line(sprintf('%-10s %7d %7d   %s', $row['size'], $row['source'], $row['dest'], $row['match'] ? 'OK' : 'MISMATCH'));
        }

        $this->line(sprintf('copied: %d   skipped: %d   stray skipped (source): %d', $report['copied'], $report['skipped'], $report['straySkipped']));
        $this->line("checksum mismatches: {$report['checksumMismatches']}");
        $this->line("stray files in destination: {$report['strayInDest']}");
        $this->line('RESULT: ' . ($report['ok'] ? 'OK' : 'FAIL'));
    }
}
