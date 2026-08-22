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
     * Every file the meme owns outright: for a video post, its single video file plus every
     * poster size variant (contracts/media-layout-video.md "Ownership"); for any other post,
     * all image size variants of its stored file — plus, either way, its YouTube thumbnail
     * only when no other post (trashed included) shares it, since thumbnails are stored once
     * per video id and yanking a shared one would break the sharing posts' rendering.
     *
     * @return list<string>
     */
    public function ownedPaths(Trashpost $post): array {
        $paths = $post->type === 'video' ? $this->videoPaths($post) : $this->imagePaths($post);
        if ($post->youtube_thumbnail !== null && !$this->thumbnailShared($post)) {
            $paths[] = $post->youtube_thumbnail;
        }
        // The unfurl preview (OgImageService), derived from whichever of the above the
        // meme has. Unlike a YouTube still it is keyed by the POST's hash, so it is never
        // shared and needs no shared-use check — but it does need listing, or a purge
        // would leave the meme's picture fetchable at /og/{hash}.jpg after every other
        // byte was deleted.
        if ($post->file !== null || $post->youtube_thumbnail !== null) {
            $paths[] = MediaPath::ogRelativePath((string) $post->hash);
        }

        return $paths;
    }

    /**
     * @return list<string>
     */
    private function imagePaths(Trashpost $post): array {
        if ($post->file === null) {
            return [];
        }
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $paths[] = MediaPath::imageRelativePath($size, $code, $ext);
        }

        return $paths;
    }

    /**
     * A video post's own video file plus every poster size variant — no sharing check, since
     * each upload's poster is derived from its own hash and never shared across posts.
     *
     * @return list<string>
     */
    private function videoPaths(Trashpost $post): array {
        $paths = [];
        if ($post->file !== null) {
            $code = pathinfo($post->file, PATHINFO_FILENAME);
            $ext = pathinfo($post->file, PATHINFO_EXTENSION);
            $paths[] = MediaPath::videoRelativePath($code, $ext);
        }
        if ($post->poster !== null) {
            $posterCode = pathinfo($post->poster, PATHINFO_FILENAME);
            foreach (MediaPath::imageSizes() as $size) {
                $paths[] = MediaPath::imageRelativePath($size, $posterCode, 'jpg');
            }
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
