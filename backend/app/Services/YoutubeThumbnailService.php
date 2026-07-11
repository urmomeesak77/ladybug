<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;
use App\Utils\Youtube;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Materializes a YouTube meme's thumbnail: TrashpostService::createPost calls ensure()
 * once at upload time, when the video id is fresh, downloading the still, storing it
 * under the dedicated media subtree (MediaPath::youtubeThumbnailRelativePath), and
 * recording its relative path on the row. This service stays callable from anywhere,
 * but the admin index deliberately no longer triggers it — a page of 100 fresh YouTube
 * rows must never stack 100 sequential downloads inside a GET. The fetch is best-effort
 * — any failure returns null so the caller renders a placeholder (FR-011) rather than
 * erroring.
 */
class YoutubeThumbnailService {
    /** Medium-quality still; always present for a real video and small enough to store. */
    private const REMOTE_URL = 'https://img.youtube.com/vi/%s/mqdefault.jpg';

    /** Cap the one-time fetch so a slow YouTube edge never stalls the index request. */
    private const TIMEOUT_SECONDS = 5;

    /**
     * The public URL of this meme's thumbnail, fetching-and-storing it once if needed,
     * or null when there is nothing usable to show.
     */
    public function ensure(Trashpost $post): ?string {
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        if ($post->youtube_thumbnail !== null) {
            // A hidden meme's thumbnail has moved off the public disk: report no URL
            // rather than a URL that 404s (the admin UI shows its placeholder).
            return $disk->exists($post->youtube_thumbnail) ? $disk->url($post->youtube_thumbnail) : null;
        }

        // Re-validate the stored id before composing the remote URL — never fetch raw
        // user input blindly (Principle VI).
        $id = Youtube::extractId((string) $post->youtube);
        if ($id === null) {
            return null;
        }

        return $this->fetchAndStore($post, $id, $disk);
    }

    /**
     * Download the still once, persist it and its relative path, and return its URL;
     * any HTTP or storage failure yields null and leaves the column unset for a retry.
     */
    private function fetchAndStore(Trashpost $post, string $id, FilesystemAdapter $disk): ?string {
        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)->get(sprintf(self::REMOTE_URL, $id));
            if (!$response->successful()) {
                return null;
            }
            $relativePath = MediaPath::youtubeThumbnailRelativePath($id);
            $disk->put($relativePath, $response->body());
            $post->youtube_thumbnail = $relativePath;
            $post->save();

            return $disk->url($relativePath);
        }
        catch (Throwable $e) {
            // Best-effort by design, but never silent: a persistent storage or network
            // misconfiguration must surface in the log, not as an eternal placeholder.
            report($e);

            return null;
        }
    }
}
