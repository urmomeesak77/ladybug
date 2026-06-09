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
     * @return array{original: string|null, default: string|null, sizes: list<array{url: string, width: int}>}
     */
    public function imageData(Trashpost $post): array {
        if ($post->file === null) {
            return ['original' => null, 'default' => null, 'sizes' => []];
        }

        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $urls = $this->existingSizeUrls($code, $ext);
        $sizes = $this->numericSizes($urls);

        return [
            'original' => $urls['original'] ?? null,
            'default' => $this->defaultUrl($urls, $sizes),
            'sizes' => $sizes,
        ];
    }

    /**
     * Public URL of every size that exists on disk, keyed by size, in MediaPath's
     * canonical widest-first order.
     *
     * @return array<string, string>
     */
    private function existingSizeUrls(string $code, string $ext): array {
        // Storage::disk() is typed as the base Filesystem contract, which omits url();
        // the runtime instance is a FilesystemAdapter that implements it.
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $urls = [];
        foreach (MediaPath::imageSizes() as $size) {
            $rel = MediaPath::imageRelativePath($size, $code, $ext);
            if ($disk->exists($rel)) {
                $urls[$size] = $disk->url($rel);
            }
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
