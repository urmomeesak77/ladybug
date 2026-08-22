<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Support\Facades\Storage;

class TrashpostImageService {
    /** The size whose URL is the preferred `default` render when it exists on disk. */
    private const DEFAULT_SIZE = '800';

    /**
     * Resolve a post's image URLs: the `original`, a preferred `default`, and the
     * numeric `sizes` (widest-first). Only sizes whose file actually exists on the
     * public disk are emitted — the API never points at a missing or fabricated file.
     *
     * A video post's `file` holds the video's own filename (not an image); its `poster`
     * — always `.jpg` — is what these fields describe instead (data-model.md, research.md
     * #4), so the code/ext pair is resolved from the right column per type.
     *
     * @return array{original: string|null, default: string|null, sizes: list<array{url: string, width: int}>}
     */
    public function imageData(Trashpost $post): array {
        $source = $post->type === 'video' ? $this->posterSource($post) : $this->fileSource($post);
        if ($source === null) {
            return ['original' => null, 'default' => null, 'sizes' => []];
        }

        [$code, $ext] = $source;
        $urls = $this->existingSizeUrls($code, $ext);
        $sizes = $this->numericSizes($urls);

        return [
            'original' => $urls['original'] ?? null,
            'default' => $this->defaultUrl($urls, $sizes),
            'sizes' => $sizes,
        ];
    }

    /**
     * Every rendition of this post that exists on the public disk, widest-first, with
     * the full-size `original` at the head. Empty when the post has no image bytes.
     *
     * The ORDER is the contract; which entry a caller wants is the caller's policy.
     * OgImageService, the only consumer, walks this list for the widest rendition that
     * fits an unfurl card — it cannot just take the head, because the original may be
     * enormous, nor the second, because on a small upload every downscale is narrower
     * than the original and may fall under the card's minimum height.
     *
     * @return list<string>
     */
    public function existingPathsWidestFirst(Trashpost $post): array {
        $source = $post->type === 'video' ? $this->posterSource($post) : $this->fileSource($post);
        if ($source === null) {
            return [];
        }

        [$code, $ext] = $source;

        // MediaPath::imageSizes() is already ordered original, 1200 … 100, and the
        // original is by construction at least as wide as any downscale of it.
        return array_values($this->existingSizePaths($code, $ext));
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private function fileSource(Trashpost $post): ?array {
        if ($post->file === null) {
            return null;
        }

        return [pathinfo($post->file, PATHINFO_FILENAME), pathinfo($post->file, PATHINFO_EXTENSION)];
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private function posterSource(Trashpost $post): ?array {
        if ($post->poster === null) {
            return null;
        }

        return [pathinfo($post->poster, PATHINFO_FILENAME), 'jpg'];
    }

    /**
     * Relative path of every size that exists on disk, keyed by size, in MediaPath's
     * canonical widest-first order.
     *
     * @return array<string, string>
     */
    private function existingSizePaths(string $code, string $ext): array {
        $disk = Storage::disk('public');
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $rel = MediaPath::imageRelativePath($size, $code, $ext);
            if ($disk->exists($rel)) {
                $paths[$size] = $rel;
            }
        }

        return $paths;
    }

    /**
     * The same set as existingSizePaths(), as public URLs.
     *
     * @return array<string, string>
     */
    private function existingSizeUrls(string $code, string $ext): array {
        // Storage::disk() is typed as the base Filesystem contract, which omits url();
        // the runtime instance is a FilesystemAdapter that implements it.
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $urls = [];
        foreach ($this->existingSizePaths($code, $ext) as $size => $rel) {
            $urls[$size] = $disk->url($rel);
        }

        return $urls;
    }

    /**
     * Preferred render URL: the 800 size, else the widest present numeric size, else
     * the original, else null.
     *
     * @param  array<string, string>  $urls
     * @param  list<array{url: string, width: int}>  $sizes
     */
    private function defaultUrl(array $urls, array $sizes): ?string {
        if (isset($urls[self::DEFAULT_SIZE])) {
            return $urls[self::DEFAULT_SIZE];
        }

        return $sizes[0]['url'] ?? $urls['original'] ?? null;
    }

    /**
     * The numeric sizes only (original excluded) as {url, width} pairs, widest-first.
     *
     * @param  array<string, string>  $urls
     * @return list<array{url: string, width: int}>
     */
    private function numericSizes(array $urls): array {
        $sizes = [];
        foreach ($urls as $size => $url) {
            // PHP casts numeric string keys to int, so original (string key) is skipped.
            if (is_int($size)) {
                $sizes[] = ['url' => $url, 'width' => $size];
            }
        }

        return $sizes;
    }
}
