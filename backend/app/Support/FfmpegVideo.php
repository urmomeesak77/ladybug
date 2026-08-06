<?php

declare(strict_types=1);

namespace App\Support;

use Symfony\Component\Process\Process;

/**
 * ffprobe/ffmpeg wrapper (approved system dependency, research.md #2) for real video-content
 * inspection and poster-frame extraction. Mirrors GifFile's Process-facade pattern — argv
 * arrays only, never a shell string (Principle VI).
 */
class FfmpegVideo {
    /**
     * @return array{width: int, height: int, codec: string}|null
     */
    public function probe(string $path): ?array {
        $process = new Process([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,codec_name', '-of', 'json', $path,
        ]);
        $process->run();
        if (!$process->isSuccessful()) {
            return null;
        }

        $decoded = json_decode($process->getOutput(), true);
        $stream = $decoded['streams'][0] ?? null;
        if (!is_array($stream) || !isset($stream['width'], $stream['height'], $stream['codec_name'])) {
            return null;
        }

        return [
            'width' => (int) $stream['width'],
            'height' => (int) $stream['height'],
            'codec' => (string) $stream['codec_name'],
        ];
    }

    /**
     * Lossless stream-copy remux that relocates the moov atom to the front of the file
     * (research.md #2). Default MP4 muxing — what phone/camera encoders and ffmpeg's own
     * default `-c copy` both produce — writes moov after mdat; Chrome's demuxer then has
     * no seek index and every seek collapses to 0 even once the file is fully buffered
     * (`video.seekable` stays `[0,0]`), while Firefox tolerates the layout. +faststart
     * fixes this without re-encoding.
     */
    public function remuxFaststart(string $srcPath, string $destPath): bool {
        $process = new Process([
            'ffmpeg', '-y', '-i', $srcPath, '-c', 'copy', '-movflags', '+faststart', $destPath,
        ]);
        $process->run();

        return $process->isSuccessful() && is_file($destPath);
    }

    public function extractPosterFrame(string $srcPath, string $destPath): bool {
        $dir = dirname($destPath);
        if (!is_dir($dir) || !is_writable($dir)) {
            throw new \RuntimeException("Cannot write image to {$destPath}");
        }

        $process = new Process(['ffmpeg', '-y', '-i', $srcPath, '-frames:v', '1', $destPath]);
        $process->run();

        return $process->isSuccessful() && is_file($destPath);
    }
}
