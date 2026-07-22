<?php

declare(strict_types=1);

namespace App\Support;

use Symfony\Component\Process\Exception\ProcessSignaledException;
use Symfony\Component\Process\Process;

/**
 * Animated-WebP resizing via the ImageMagick `convert` CLI (owner-approved 2026-07-22; shipped
 * in the ladybug-php image and installed in CI). GD decodes only a WebP's first frame, so
 * resizing an animation through ImageFile would flatten it — exactly the reason animated GIFs
 * use gifsicle. Static WebP still goes through ImageFile; this class handles only the animated
 * case. Mirrors GifFile/ImageFile::scaledDownCopy so TrashpostImageProcessor treats all alike.
 */
class WebpFile {
    /**
     * True when the WebP carries animation. WebP's extended (VP8X) header sets a dedicated
     * animation flag (bit 1 of the flags byte); a plain VP8/VP8L file has no VP8X chunk and is
     * never animated. Reading the fixed 21-byte header is enough — no full decode (research R3).
     */
    public function isAnimated(string $path): bool {
        $header = (string) file_get_contents($path, false, null, 0, 21);
        if (strlen($header) < 21 || substr($header, 0, 4) !== 'RIFF' || substr($header, 8, 4) !== 'WEBP') {
            return false;
        }
        if (substr($header, 12, 4) !== 'VP8X') {
            return false;
        }

        return (ord($header[20]) & 0x02) !== 0;
    }

    /**
     * Write a proportionally downscaled, frame-preserving copy at $targetWidth. Returns false
     * without writing when the source is not wider than the target (we never upscale).
     */
    public function scaledDownCopy(string $srcPath, string $destPath, int $targetWidth): bool {
        $info = getimagesize($srcPath);
        if ($info === false) {
            throw new \RuntimeException("Unreadable image: {$srcPath}");
        }
        if ($info[0] <= $targetWidth) {
            return false;
        }

        // Fail fast on an unwritable destination (same contract as ImageFile/GifFile) so a
        // failed variant can never be silently committed while the feed points at it.
        $dir = dirname($destPath);
        if (!is_dir($dir) || !is_writable($dir)) {
            throw new \RuntimeException("Cannot write image to {$destPath}");
        }

        if (!$this->resize($srcPath, $destPath, $targetWidth)) {
            throw new \RuntimeException("Failed to write image: {$destPath}");
        }

        return true;
    }

    private function resize(string $srcPath, string $destPath, int $targetWidth): bool {
        // -coalesce expands each frame to a full canvas before scaling; -layers optimize
        // re-optimizes afterwards. All frames survive, unlike GD's first-frame-only decode.
        return $this->run([
            'convert', $srcPath, '-coalesce', '-resize', "{$targetWidth}x", '-layers', 'optimize', $destPath,
        ]);
    }

    /**
     * @param  list<string>  $command
     */
    private function run(array $command): bool {
        // argv array, never a shell string: the paths cannot inject shell syntax (Principle VI).
        $process = new Process($command);
        try {
            $process->run();
        }
        catch (ProcessSignaledException) {
            // convert can abort on a malformed input — a failure, not a PHP error.
            return false;
        }

        return $process->isSuccessful();
    }
}
