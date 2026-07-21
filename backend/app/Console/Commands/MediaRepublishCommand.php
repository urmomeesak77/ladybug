<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Trashpost;
use App\Services\MediaOwnershipService;
use Illuminate\Console\Command;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * One-time reconciliation: media now lives on the public disk in every state (design
 * 2026-07-21), but memes hidden under the old move-on-hide code have their bytes on the
 * private 'local' disk and will not render in the admin console until moved back. This
 * moves every owned file still on 'local' to 'public'. Idempotent — files missing from
 * 'local' (already public, or never written) are skipped — so it is safe to re-run.
 */
final class MediaRepublishCommand extends Command {
    protected $signature = 'media:republish';

    protected $description = 'Move any meme media still on the private disk back to the public disk';

    public function __construct(private readonly MediaOwnershipService $media = new MediaOwnershipService()) {
        parent::__construct();
    }

    public function handle(): int {
        $local = $this->disk('local');
        $public = $this->disk('public');
        $moved = 0;
        foreach (Trashpost::withTrashed()->cursor() as $post) {
            foreach ($this->media->ownedPaths($post) as $path) {
                if ($this->move($local, $public, $path)) {
                    $moved++;
                }
            }
        }
        $this->info("Republished {$moved} file(s) to the public disk.");

        return self::SUCCESS;
    }

    /**
     * Streamed local→public move so a full-size original never has to fit in memory. A
     * missing source (already public) is skipped; a failed target write keeps the source
     * so the file is never lost. Returns whether a byte actually moved.
     */
    private function move(FilesystemAdapter $from, FilesystemAdapter $to, string $path): bool {
        if (!$from->exists($path)) {
            return false;
        }
        $stream = $from->readStream($path);
        if ($stream === null) {
            return false;
        }
        $copied = $to->put($path, $stream);
        if (is_resource($stream)) {
            fclose($stream);
        }
        if ($copied === false) {
            return false;
        }
        $from->delete($path);

        return true;
    }

    private function disk(string $name): FilesystemAdapter {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk($name);

        return $disk;
    }
}
