<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\FfmpegVideo;
use App\Support\MediaPath;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\File as StoredFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

/**
 * The upload write path for a video post: store the video file, extract its poster frame,
 * and reuse the existing image size-variant pipeline for the poster (research.md #4) — no
 * duplicated variant logic. Pairs with TrashpostImageProcessor exactly as an image upload does.
 */
class TrashpostVideoProcessor {
    public function __construct(
        private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor(),
        private readonly FfmpegVideo $ffmpeg = new FfmpegVideo(),
    ) {
    }

    /**
     * @return array{file: string, type: string, metadata: string, poster: string}
     */
    public function process(UploadedFile $file, string $hash): array {
        $ext = $this->extensionFor($file);
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        $videoRel = MediaPath::videoRelativePath($hash, $ext);
        $this->storeVideo($file, $ext, $disk, $videoRel);
        $videoPath = $disk->path($videoRel);

        $posterOriginalRel = MediaPath::imageRelativePath('original', $hash, 'jpg');
        $posterOriginalPath = $disk->path($posterOriginalRel);
        File::ensureDirectoryExists(dirname($posterOriginalPath));
        if (!$this->ffmpeg->extractPosterFrame($videoPath, $posterOriginalPath)) {
            throw new \RuntimeException("Failed to extract poster frame for {$hash}");
        }

        $probe = $this->ffmpeg->probe($videoPath);
        if ($probe === null) {
            // The validator guarantees a decodable video before we get here; a failure now
            // is a genuine I/O fault, not user input.
            throw new \RuntimeException("Unreadable video: {$videoPath}");
        }

        $this->images->generateMissingVariants($posterOriginalPath, $hash, 'jpg');

        return [
            'file' => "{$hash}.{$ext}",
            'type' => 'video',
            'metadata' => $this->metadata($probe, $file),
            'poster' => "{$hash}.jpg",
        ];
    }

    /**
     * webm is stored as uploaded. mp4 is remuxed through ffmpeg first (a lossless stream
     * copy, +faststart — see FfmpegVideo::remuxFaststart) so every stored video is
     * seekable in Chrome, not just Firefox, regardless of how the source encoder muxed it.
     */
    private function storeVideo(UploadedFile $file, string $ext, FilesystemAdapter $disk, string $videoRel): void {
        if ($ext !== 'mp4') {
            $disk->putFileAs(dirname($videoRel), $file, basename($videoRel));

            return;
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'ladybug_video_');
        unlink($tmpPath);
        $tmpPath .= '.mp4';
        try {
            if (!$this->ffmpeg->remuxFaststart($file->getRealPath(), $tmpPath)) {
                throw new \RuntimeException('Failed to remux video for faststart playback.');
            }
            $disk->putFileAs(dirname($videoRel), new StoredFile($tmpPath), basename($videoRel));
        }
        finally {
            if (is_file($tmpPath)) {
                unlink($tmpPath);
            }
        }
    }

    /**
     * Remove every file process() may have written for this hash — the video file and every
     * poster size variant. Mirrors TrashpostImageProcessor::discard() but does NOT delegate to
     * it, because that method derives its extension from the file's own MIME (which here is a
     * video MIME, not jpg) — this loop is deliberately self-contained.
     */
    public function discard(string $hash, UploadedFile $file): void {
        $ext = $this->extensionFor($file);
        $disk = Storage::disk('public');
        $videoRel = MediaPath::videoRelativePath($hash, $ext);
        if ($disk->exists($videoRel)) {
            $disk->delete($videoRel);
        }
        foreach (MediaPath::imageSizes() as $size) {
            $posterRel = MediaPath::imageRelativePath($size, $hash, 'jpg');
            if ($disk->exists($posterRel)) {
                $disk->delete($posterRel);
            }
        }
    }

    /**
     * Derive the stored extension from the validated content type, never the client-supplied
     * filename (Principle VI) — mirrors TrashpostImageProcessor::extensionFor().
     */
    private function extensionFor(UploadedFile $file): string {
        return match ($file->getMimeType()) {
            'video/webm' => 'webm',
            default => 'mp4',
        };
    }

    /**
     * @param  array{width: int, height: int, codec: string}  $probe
     */
    private function metadata(array $probe, UploadedFile $file): string {
        return (string) json_encode([
            'width' => $probe['width'],
            'height' => $probe['height'],
            'ratio' => $probe['height'] === 0 ? 0 : round($probe['width'] / $probe['height'], 4),
            'mime' => $file->getMimeType(),
        ]);
    }
}
