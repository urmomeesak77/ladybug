<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * Keeps a meme's files on the disk that matches its visibility. The public disk is
 * URL-addressable by anyone who ever saw the hash, so a moderated (soft-deleted or
 * deactivated) meme's media must physically leave it — hiding the JSON while still
 * serving the bytes would let saved permalinks bypass moderation (review 2026-07-10).
 * Files move to the private `local` disk under the same relative path, so restoring
 * is the mirror move.
 */
class MediaVisibilityService {
    /**
     * Move this meme's files to whichever disk matches its current visibility
     * (public ⇔ activated and not trashed). Idempotent: moves skip paths missing
     * from the source disk, so repeated transitions converge.
     */
    public function sync(Trashpost $post): void {
        if ($post->activated_at !== null && !$post->trashed()) {
            $this->moveAll($post, $this->disk('local'), $this->disk('public'));
        }
        else {
            $this->moveAll($post, $this->disk('public'), $this->disk('local'));
        }
    }

    /**
     * Every file the meme owns outright: all image size variants of its stored
     * file, plus its YouTube thumbnail only when no other post (trashed included)
     * shares it — thumbnails are stored once per video id, and yanking a shared
     * one would break the sharing posts' rendering.
     *
     * @return list<string>
     */
    public function ownedPaths(Trashpost $post): array {
        $paths = [];
        if ($post->file !== null) {
            $code = pathinfo($post->file, PATHINFO_FILENAME);
            $ext = pathinfo($post->file, PATHINFO_EXTENSION);
            foreach (MediaPath::imageSizes() as $size) {
                $paths[] = MediaPath::imageRelativePath($size, $code, $ext);
            }
        }
        if ($post->youtube_thumbnail !== null && !$this->thumbnailShared($post)) {
            $paths[] = $post->youtube_thumbnail;
        }

        return $paths;
    }

    private function moveAll(Trashpost $post, FilesystemAdapter $from, FilesystemAdapter $to): void {
        foreach ($this->ownedPaths($post) as $path) {
            $this->move($from, $to, $path);
        }
    }

    /**
     * Cross-disk move, streamed so a full-size original never has to fit in
     * memory. Missing sources are skipped (already moved, or never written) —
     * that is what makes sync() idempotent.
     */
    private function move(FilesystemAdapter $from, FilesystemAdapter $to, string $path): void {
        if (!$from->exists($path)) {
            return;
        }
        $stream = $from->readStream($path);
        if ($stream === null) {
            return;
        }
        $copied = $to->put($path, $stream);
        if (is_resource($stream)) {
            fclose($stream);
        }
        // Both disks are throw=false, so a failed write (full disk, permissions)
        // surfaces as a false return. A failed copy must never destroy the only
        // copy — keep the source; a later sync() will retry the move.
        if ($copied === false) {
            return;
        }
        $from->delete($path);
    }

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }

    private function disk(string $name): FilesystemAdapter {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk($name);

        return $disk;
    }
}
