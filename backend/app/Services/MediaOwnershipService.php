<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;

/**
 * Enumerates the disk files a meme owns outright. Media now lives on the public disk in
 * every state (design 2026-07-21, reversing the 2026-07-10 anti-bypass move), so this
 * class no longer moves anything — its one job is telling purge which files to delete.
 */
class MediaOwnershipService {
    /**
     * Every file the meme owns outright: all image size variants of its stored file, plus
     * its YouTube thumbnail only when no other post (trashed included) shares it —
     * thumbnails are stored once per video id, and yanking a shared one would break the
     * sharing posts' rendering.
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

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }
}
