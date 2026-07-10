<?php

declare(strict_types=1);

namespace App\Support;

use Symfony\Component\Process\Exception\ProcessSignaledException;
use Symfony\Component\Process\Process;

/**
 * Animated-GIF resizing via the gifsicle CLI (approved system dependency, shipped in the
 * ladybug-php image and installed in CI). GD can only decode a GIF's first frame, so
 * resizing through ImageFile would flatten animations; gifsicle rescales every frame.
 * Mirrors ImageFile::scaledDownCopy so TrashpostImageProcessor treats both alike.
 */
class GifFile {
    /**
     * Write a proportionally downscaled copy at $targetWidth. Returns false without writing
     * when the source is not wider than the target (we never upscale).
     */
    public function scaledDownCopy(string $srcPath, string $destPath, int $targetWidth): bool {
        $info = getimagesize($srcPath);
        if ($info === false) {
            throw new \RuntimeException("Unreadable image: {$srcPath}");
        }
        if ($info[0] <= $targetWidth) {
            return false;
        }

        // Fail fast on an unwritable destination (same contract as ImageFile::write) so a
        // failed variant can never be silently committed while the feed points at it.
        $dir = dirname($destPath);
        if (!is_dir($dir) || !is_writable($dir)) {
            throw new \RuntimeException("Cannot write image to {$destPath}");
        }

        if (!$this->resize($srcPath, $destPath, $targetWidth)) {
            $this->normalizedResize($srcPath, $destPath, $targetWidth);
        }

        return true;
    }

    private function resize(string $srcPath, string $destPath, int $targetWidth): bool {
        return $this->run(['gifsicle', '--resize-width', (string) $targetWidth, $srcPath, '-o', $destPath]);
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
            // gifsicle aborts (SIGABRT) on some malformed GIFs — a failure, not a PHP error.
            return false;
        }

        return $process->isSuccessful();
    }

    /**
     * Rescue path for GIFs the direct resize cannot handle: some real uploads draw frames
     * past the logical screen, which aborts gifsicle's resize on an xform.c assertion.
     * Rewriting the palette and unoptimizing normalizes the frame geometry first.
     */
    private function normalizedResize(string $srcPath, string $destPath, int $targetWidth): void {
        $colored = (string) tempnam(sys_get_temp_dir(), 'gif');
        $plain = (string) tempnam(sys_get_temp_dir(), 'gif');
        $steps = [
            ['gifsicle', '--colors', '255', $srcPath, '-o', $colored],
            ['gifsicle', '--unoptimize', $colored, '-o', $plain],
            ['gifsicle', '--resize-width', (string) $targetWidth, $plain, '-o', $destPath],
        ];
        try {
            foreach ($steps as $command) {
                if (!$this->run($command)) {
                    throw new \RuntimeException("Failed to write image: {$destPath}");
                }
            }
        }
        finally {
            unlink($colored);
            unlink($plain);
        }
    }
}
