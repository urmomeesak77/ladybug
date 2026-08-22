<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Pure path/shard rules for Ladybug's on-disk media tree (contract:
 * specs/003-media-storage/contracts/media-layout.md). Images live at
 * image/trash/{size}/{shard}/{code}.{ext}; videos at video/trash/{shard}/{code}.{ext}.
 * No I/O here so the seed command and the future upload feature can share and unit-test it.
 */
final class MediaPath {
    private const IMAGE_ROOT = 'image/trash';

    private const VIDEO_ROOT = 'video/trash';

    /** Filenames that do not start [a-z0-9] are bucketed here, never their raw lead char. */
    private const OTHER_SHARD = 'other';

    /** Ordered widest-to-narrowest so reports iterate deterministically. */
    private const IMAGE_SIZES = ['original', '1200', '800', '500', '300', '100'];

    /** Only these are treated as media; anything else (e.g. .gitignore) is a stray. */
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

    /** MOV/AVI/MKV etc. are explicitly excluded (research.md #1 — no server-side transcoding). */
    private const VIDEO_EXTENSIONS = ['mp4', 'webm'];

    /**
     * @return list<string>
     */
    public static function imageSizes(): array {
        return self::IMAGE_SIZES;
    }

    public static function shardFor(string $filename): string {
        $lead = strtolower(substr($filename, 0, 1));

        // Keep any single directory from holding the whole library; non-[a-z0-9] leads
        // (hidden/dash-prefixed names) share one bucket so they remain locatable.
        return preg_match('/^[a-z0-9]$/', $lead) === 1 ? $lead : self::OTHER_SHARD;
    }

    public static function isMediaFile(string $filename): bool {
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

        return in_array($ext, self::IMAGE_EXTENSIONS, true);
    }

    public static function isVideoFile(string $filename): bool {
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

        return in_array($ext, self::VIDEO_EXTENSIONS, true);
    }

    public static function imageRelativePath(string $size, string $code, string $ext): string {
        $shard = self::shardFor("{$code}.{$ext}");

        return self::IMAGE_ROOT . "/{$size}/{$shard}/{$code}.{$ext}";
    }

    public static function videoRelativePath(string $code, string $ext): string {
        $shard = self::shardFor("{$code}.{$ext}");

        // Videos are not resized, so there is no {size} segment — sibling of the image root.
        return self::VIDEO_ROOT . "/{$shard}/{$code}.{$ext}";
    }

    /**
     * The unfurl preview for one meme: always JPEG, keyed by the POST's hash rather
     * than its media filename.
     *
     * The format is the whole point — X's card crawler produces no image at all from
     * a WebP og:image, which silently downgrades every WebP upload's card to the
     * small no-image layout. Keying by post hash rather than media filename is what
     * keeps a YouTube meme's copy private: its thumbnail is shared across every post
     * citing the same video, and a shared preview could not be deleted with one post.
     */
    public static function ogRelativePath(string $hash): string {
        $shard = self::shardFor("{$hash}.jpg");

        return self::IMAGE_ROOT . "/og/{$shard}/{$hash}.jpg";
    }

    public static function youtubeThumbnailRelativePath(string $videoId): string {
        $shard = self::shardFor("{$videoId}.jpg");

        // Dedicated subtree for the once-downloaded YouTube stills, sharded by the
        // video id's lead char so no single directory holds the whole library.
        return self::IMAGE_ROOT . "/youtube/{$shard}/{$videoId}.jpg";
    }
}
