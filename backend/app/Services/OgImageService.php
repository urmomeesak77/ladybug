<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\ImageFile;
use App\Support\MediaPath;
use App\Support\WebpFile;
use Illuminate\Support\Facades\Storage;

/**
 * Produces and caches the JPEG one meme unfurls with.
 *
 * The format is the entire reason this class exists. A meme uploaded as WebP has
 * only WebP variants on disk, and X's card crawler produces NO image at all from a
 * WebP og:image — the card silently degrades to the small no-image layout while the
 * title and description still arrive, so nothing about the page looks broken from
 * the server's side. Measured 2026-08-22 against @da_staar: every WebP post's card
 * was imageless, the one working card belonged to a video post, whose preview is
 * the ffmpeg poster and therefore already JPEG.
 *
 * Generation is lazy and happens ONCE per meme: only crawlers fetch this address,
 * and the second fetch of a given meme is a plain file read.
 */
class OgImageService {
    /**
     * The widest rendition worth deriving a card image from. Matches the widest size
     * variant the upload pipeline produces (MediaPath::imageSizes), so in practice only
     * an oversized `original` is ever skipped.
     */
    private const MAX_PREVIEW_WIDTH = 1200;

    public function __construct(
        private readonly TrashpostImageService $images,
        private readonly ImageFile $imageFile,
        private readonly WebpFile $webpFile,
    ) {
    }

    /**
     * Relative path on the public disk of this meme's JPEG preview, generating it on
     * the first call. Null when the meme has no image bytes to derive one from.
     *
     * @throws \RuntimeException when the source exists but cannot be decoded
     */
    public function ensure(Trashpost $post): ?string {
        $disk = Storage::disk('public');
        $destination = MediaPath::ogRelativePath((string) $post->hash);
        if ($disk->exists($destination)) {
            return $destination;
        }

        $source = $this->sourcePath($post);
        if ($source === null) {
            return null;
        }

        $this->transcode($source, $destination);

        return $destination;
    }

    /**
     * Whether this meme has anything to derive a preview from.
     *
     * PageMeta asks before advertising /og/{hash}.jpg, so the two cannot disagree: a
     * meme with no bytes keeps the branded logo on a `summary` card rather than
     * claiming a large-image card backed by a 404.
     */
    public function hasSource(Trashpost $post): bool {
        if ($this->images->existingPathsWidestFirst($post) !== []) {
            return true;
        }
        $thumbnail = $post->youtube_thumbnail;

        return $thumbnail !== null && Storage::disk('public')->exists($thumbnail);
    }

    /**
     * The bytes to derive the preview from: the widest rendition of the meme that fits
     * the card, else the still downloaded for a YouTube meme at upload time.
     *
     * "Widest that fits" and not simply "widest": the full-size original can be several
     * thousand pixels across, which is bytes no card needs and which X rejects outright
     * past 5 MB. But it cannot simply be skipped either — a 400x200 upload has no
     * downscale wider than 300, and 300x150 is UNDER X's 300x157 floor for a
     * large-image card, so skipping the original would cost that meme its card for the
     * opposite reason. Walking widest-first and taking the first within the cap gets
     * both: the original when the upload was small, a downscale when it was not.
     */
    private function sourcePath(Trashpost $post): ?string {
        $candidates = $this->images->existingPathsWidestFirst($post);
        foreach ($candidates as $path) {
            if ($this->widthOf($path) <= self::MAX_PREVIEW_WIDTH) {
                return $path;
            }
        }
        // Every rendition is over the cap — impossible while the widest variant is 1200,
        // but if it ever is, the narrowest is still a better card than none.
        if ($candidates !== []) {
            return $candidates[count($candidates) - 1];
        }

        $thumbnail = $post->youtube_thumbnail;
        // Checked rather than assumed: YoutubeThumbnailService's download can have
        // failed, and a missing source should read as "no preview", not as an error.
        if ($thumbnail === null || !Storage::disk('public')->exists($thumbnail)) {
            return null;
        }

        return $thumbnail;
    }

    /**
     * Width of one rendition, or 0 for anything unreadable — so a corrupt file scores
     * as narrow, loses the cap test, and the next candidate is tried instead.
     *
     * The suppression is deliberate and is the only one in the application. This is a
     * PROBE: "not a readable image" is an answer this method returns, not a fault worth
     * a log line, and getimagesize() reports it by both returning false AND emitting a
     * notice. Under the framework's error handler that notice becomes an ErrorException,
     * which would turn an answer into a thrown exception two frames up.
     */
    private function widthOf(string $relativePath): int {
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $info = @getimagesize($disk->path($relativePath));

        return $info === false ? 0 : (int) $info[0];
    }

    /**
     * Write the JPEG into place via a temp file in the SAME directory.
     *
     * rename() is atomic within one filesystem, so two crawlers racing a cold URL can
     * never serve each other a half-written file — the loser simply overwrites with
     * identical bytes. Writing straight to the destination has no such guarantee.
     */
    private function transcode(string $source, string $destination): void {
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $disk->makeDirectory(dirname($destination));
        $temporary = $disk->path(dirname($destination) . '/.' . uniqid('og', true) . '.jpg');

        try {
            $this->writeJpeg($disk->path($source), $temporary);
            rename($temporary, $disk->path($destination));
        }
        finally {
            // A throw between the two calls would otherwise leave the partial file in
            // the served directory forever; nothing ever reads it, but it still costs
            // an inode per failed attempt.
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    /**
     * The one branch in the transcode, and it mirrors TrashpostImageProcessor::resizerFor:
     * an ANIMATED WebP goes through ImageMagick, everything else through GD.
     *
     * Not an optimisation — GD cannot open an animated WebP at all. It fails with
     * "gd-webp cannot allocate temporary buffer" rather than decoding frame one, so
     * without this branch the most common broken-card case on the site (a WebP upload)
     * would answer 500 instead of a preview. Animated GIF needs no such branch:
     * imagecreatefromgif() does return the first frame.
     */
    private function writeJpeg(string $source, string $destination): void {
        $isWebp = strtolower((string) pathinfo($source, PATHINFO_EXTENSION)) === 'webp';
        if ($isWebp && $this->webpFile->isAnimated($source)) {
            $this->webpFile->firstFrameAsJpeg($source, $destination);

            return;
        }

        $this->imageFile->copyAsJpeg($source, $destination);
    }
}
