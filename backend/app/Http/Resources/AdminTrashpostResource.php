<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Support\MediaPath;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

/**
 * The compact moderation-table row (data-model.md): just what the back-office table needs
 * to list and act on a meme. Deliberately omits the DB id, user_id, and file path — the
 * hash is the only public identifier (Principle V), mirroring TrashpostResource.
 *
 * @mixin \App\Models\Trashpost
 */
class AdminTrashpostResource extends JsonResource {
    /** The thumbnail is the smallest stored image variant. */
    private const THUMBNAIL_SIZE = '100';

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        return [
            'hash' => $this->hash,
            'thumbnail' => $this->thumbnailUrl(),
            'title' => $this->title,
            'type' => $this->type,
            'username' => $this->uploaderName(),
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
            'activated_at' => $this->activated_at?->format('Y-m-d H:i:s'),
            'deleted_at' => $this->deleted_at?->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * The uploader's account name when the owner resolves, else the name stored on the
     * row at upload time (FR-012) — an orphaned meme still shows who posted it.
     */
    private function uploaderName(): ?string {
        return $this->user?->name ?? $this->username;
    }

    /**
     * The row thumbnail URL: the 100-size image variant for an image meme, the once-fetched
     * still for a YouTube meme, or null when neither can be produced (→ UI placeholder).
     */
    private function thumbnailUrl(): ?string {
        if ($this->type === 'youtube') {
            // Prefer the dedicated still fetched at upload time; migrated prototype posts
            // never populated that column but kept their still as a normal image file
            // (with size variants), so fall back to the stored 100-variant.
            return $this->youtubeThumbnailUrl() ?? $this->imageThumbnailUrl();
        }
        if ($this->type === 'video') {
            // `file` is the video's own filename for this type — the thumbnail is the
            // generated poster instead (contracts/api-posts.md "GET /api/admin/posts").
            return $this->posterThumbnailUrl();
        }

        return $this->imageThumbnailUrl();
    }

    /**
     * The stored still's public URL, or null (→ UI placeholder). Fetching happens at
     * upload time (TrashpostService); the index does zero remote IO — a page of 100
     * fresh YouTube rows must not stack downloads inside a GET (review 2026-07-10).
     */
    private function youtubeThumbnailUrl(): ?string {
        if ($this->youtube_thumbnail === null) {
            return null;
        }

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->exists($this->youtube_thumbnail) ? $disk->url($this->youtube_thumbnail) : null;
    }

    /**
     * The public URL of the 100-size variant when it exists on disk, else null — the API
     * never points at a missing or fabricated file.
     */
    private function imageThumbnailUrl(): ?string {
        if ($this->file === null) {
            return null;
        }

        $code = pathinfo($this->file, PATHINFO_FILENAME);
        $ext = pathinfo($this->file, PATHINFO_EXTENSION);
        $relativePath = MediaPath::imageRelativePath(self::THUMBNAIL_SIZE, $code, $ext);

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->exists($relativePath) ? $disk->url($relativePath) : null;
    }

    /**
     * The stored poster's 100-size variant public URL for a video post, else null (→ UI
     * placeholder). Mirrors imageThumbnailUrl()'s shape but is keyed on `poster`, always
     * `.jpg`, since `file` holds the video's own filename for this type.
     */
    private function posterThumbnailUrl(): ?string {
        if ($this->poster === null) {
            return null;
        }

        $code = pathinfo($this->poster, PATHINFO_FILENAME);
        $relativePath = MediaPath::imageRelativePath(self::THUMBNAIL_SIZE, $code, 'jpg');

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->exists($relativePath) ? $disk->url($relativePath) : null;
    }
}
