<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\GifFile;
use App\Support\ImageFile;
use App\Support\MediaPath;
use App\Support\WebpFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

/**
 * The upload write path: store an uploaded image as the canonical original, generate the
 * narrower size variants the feed serves, and extract the dimension metadata the frontend
 * reads. Pairs with TrashpostImageService (read side) and reuses MediaPath for all paths.
 */
class TrashpostImageProcessor {
    public function __construct(
        private readonly ImageFile $imageFile = new ImageFile(),
        private readonly GifFile $gifFile = new GifFile(),
        private readonly WebpFile $webpFile = new WebpFile(),
    ) {
    }

    /**
     * @return array{file: string, type: string, metadata: string}
     */
    public function process(UploadedFile $file, string $hash): array {
        $ext = $this->extensionFor($file);
        $disk = Storage::disk('public');

        $originalRel = MediaPath::imageRelativePath('original', $hash, $ext);
        $disk->putFileAs(dirname($originalRel), $file, basename($originalRel));
        $originalPath = $disk->path($originalRel);

        [$width, $height] = $this->imageFile->dimensions($originalPath);

        $this->generateVariants($hash, $ext, $originalPath, $width);

        return [
            'file' => "{$hash}.{$ext}",
            'type' => 'image',
            'metadata' => $this->metadata($width, $height, $originalPath),
        ];
    }

    /**
     * Remove every file process() may have written for this hash — the original and all
     * size variants. Rolls back a failed upload so no orphaned media lingers on disk and
     * the hash's paths are clean for whoever mints it next.
     */
    public function discard(string $hash, UploadedFile $file): void {
        $ext = $this->extensionFor($file);
        $disk = Storage::disk('public');
        foreach (MediaPath::imageSizes() as $size) {
            $rel = MediaPath::imageRelativePath($size, $hash, $ext);
            if ($disk->exists($rel)) {
                $disk->delete($rel);
            }
        }
    }

    /**
     * Derive the stored extension from the validated content type, never the client-supplied
     * filename (Principle VI): a polyglot uploaded as evil.php must still be stored as a safe
     * image extension. Only the three MIME types CreatePostRequest admits are mapped.
     */
    private function extensionFor(UploadedFile $file): string {
        return match ($file->getMimeType()) {
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            default => 'jpg',
        };
    }

    private function generateVariants(string $hash, string $ext, string $originalPath, int $width): void {
        // Pick the resizer once: animated formats (GIF, animated WebP) need a frame-preserving
        // CLI; everything else (incl. static WebP) resizes in GD via ImageFile.
        $resizer = $this->resizerFor($ext, $originalPath);
        foreach (MediaPath::imageSizes() as $size) {
            if ($size === 'original' || (int) $size >= $width) {
                continue;
            }
            $variantPath = Storage::disk('public')->path(MediaPath::imageRelativePath($size, $hash, $ext));
            File::ensureDirectoryExists(dirname($variantPath));
            $resizer->scaledDownCopy($originalPath, $variantPath, (int) $size);
        }
    }

    /**
     * GD flattens animation to the first frame, so animated formats resize through a CLI:
     * GIF via gifsicle, animated WebP via ImageMagick. Static WebP stays on the GD path.
     */
    private function resizerFor(string $ext, string $originalPath): ImageFile|GifFile|WebpFile {
        if ($ext === 'gif') {
            return $this->gifFile;
        }
        if ($ext === 'webp' && $this->webpFile->isAnimated($originalPath)) {
            return $this->webpFile;
        }

        return $this->imageFile;
    }

    private function metadata(int $width, int $height, string $path): string {
        return (string) json_encode([
            'width' => $width,
            'height' => $height,
            'ratio' => $height === 0 ? 0 : round($width / $height, 4),
            'mime' => $this->imageFile->mime($path),
        ]);
    }
}
