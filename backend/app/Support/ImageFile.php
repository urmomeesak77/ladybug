<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Thin ext-gd wrapper for upload processing (Principle I — no image package). Operates on
 * real filesystem paths so it can run against the public disk's backing files (incl.
 * Storage::fake in tests). Handles jpg/png/gif and static WebP — animated WebP goes through
 * WebpFile (ImageMagick) instead, since GD would flatten it to one frame.
 */
class ImageFile {
    /**
     * @return array{0: int, 1: int} [width, height]
     */
    public function dimensions(string $path): array {
        $info = getimagesize($path);
        if ($info === false) {
            // The validator guarantees a well-formed image before we get here; a failure
            // now is a genuine I/O fault, not user input — surface it loudly.
            throw new \RuntimeException("Unreadable image: {$path}");
        }

        return [$info[0], $info[1]];
    }

    public function mime(string $path): string {
        $info = getimagesize($path);

        return $info === false ? 'application/octet-stream' : $info['mime'];
    }

    /**
     * Write a proportionally downscaled copy at $targetWidth. Returns false without writing
     * when the source is not wider than the target (we never upscale).
     */
    public function scaledDownCopy(string $srcPath, string $destPath, int $targetWidth): bool {
        [$width] = $this->dimensions($srcPath);
        if ($width <= $targetWidth) {
            return false;
        }

        $src = $this->read($srcPath);
        $scaled = imagescale($src, $targetWidth);
        imagedestroy($src);
        if ($scaled === false) {
            return false;
        }

        $this->write($scaled, $destPath);
        imagedestroy($scaled);

        return true;
    }

    /**
     * Write $srcPath out as JPEG at its own dimensions, flattening any transparency
     * onto white.
     *
     * The flatten is the load-bearing half: JPEG has no alpha channel, and GD writes
     * transparent pixels as BLACK if they are not composited first, which turns a
     * meme on a clear background into a black slab. Animated sources (GIF, WebP)
     * yield their first frame, which is what an unfurl card shows anyway.
     */
    public function copyAsJpeg(string $srcPath, string $destPath): void {
        $src = $this->read($srcPath);
        $width = imagesx($src);
        $height = imagesy($src);
        $flat = imagecreatetruecolor($width, $height);
        // Blending ON so the copy composites source alpha against the white fill
        // rather than overwriting it with the source's own transparent pixels.
        imagealphablending($flat, true);
        imagefilledrectangle($flat, 0, 0, $width, $height, (int) imagecolorallocate($flat, 255, 255, 255));
        imagecopy($flat, $src, 0, 0, 0, 0, $width, $height);
        imagedestroy($src);

        $this->write($flat, $destPath);
        imagedestroy($flat);
    }

    private function read(string $path): \GdImage {
        // Rejected here rather than by the GD reader, which emits its own E_WARNING on
        // the way to returning false — noise on a path this method already handles by
        // throwing. getimagesize() answers the same question silently.
        if (getimagesize($path) === false) {
            throw new \RuntimeException("Unreadable image: {$path}");
        }

        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        $img = match ($ext) {
            'png' => imagecreatefrompng($path),
            'gif' => imagecreatefromgif($path),
            'webp' => imagecreatefromwebp($path),
            default => imagecreatefromjpeg($path),
        };
        if ($img === false) {
            throw new \RuntimeException("Unreadable image: {$path}");
        }

        return $img;
    }

    private function write(\GdImage $img, string $path): void {
        // Fail fast on an unwritable destination so a failed variant can never be silently
        // committed while the feed points at a missing file. Checking up front also avoids
        // the GD writers' own E_WARNING on a bad path.
        $dir = dirname($path);
        if (!is_dir($dir) || !is_writable($dir)) {
            throw new \RuntimeException("Cannot write image to {$path}");
        }

        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        $ok = match ($ext) {
            'png' => imagepng($img, $path),
            'gif' => imagegif($img, $path),
            'webp' => imagewebp($img, $path, 85),
            default => imagejpeg($img, $path, 85),
        };
        if ($ok === false) {
            throw new \RuntimeException("Failed to write image: {$path}");
        }
    }
}
