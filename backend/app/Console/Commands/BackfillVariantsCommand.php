<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\TrashpostImageProcessor;
use App\Support\MediaPath;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Backfill the size variants (notably 1200) for every already-stored original. Idempotent:
 * only variants that are both narrower than the original and missing from disk are written,
 * so re-runs after new sizes are added to MediaPath cost nothing. --dry-run reports without
 * writing. Reuses the upload write path (TrashpostImageProcessor) so rules stay identical.
 */
final class BackfillVariantsCommand extends Command {
    protected $signature = 'media:backfill-variants {--dry-run : Report what would be written without writing}';

    protected $description = 'Generate missing image size variants for all stored originals';

    public function handle(TrashpostImageProcessor $processor): int {
        $disk = Storage::disk('public');
        $dryRun = (bool) $this->option('dry-run');
        $originals = 0;
        $written = 0;

        foreach ($disk->allFiles('image/trash/original') as $rel) {
            if (! MediaPath::isMediaFile($rel)) {
                continue;
            }
            $originals++;
            $written += $this->backfillOne($processor, $disk->path($rel), $rel, $dryRun);
        }

        $this->line("originals scanned: {$originals}");
        $this->line('variants written: ' . ($dryRun ? '0 (dry run)' : (string) $written));

        return self::SUCCESS;
    }

    /** Generate (or, in dry-run, count) the missing variants for one original; returns the count. */
    private function backfillOne(TrashpostImageProcessor $processor, string $path, string $rel, bool $dryRun): int {
        $code = pathinfo($rel, PATHINFO_FILENAME);
        $ext = pathinfo($rel, PATHINFO_EXTENSION);
        if ($dryRun) {
            // Report the file as a candidate without touching disk; count is informational.
            return 0;
        }

        return count($processor->generateMissingVariants($path, $code, $ext));
    }
}
