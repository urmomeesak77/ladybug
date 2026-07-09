<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Services\YoutubeThumbnailService;
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
            'type' => $this->type,
            'username' => $this->uploaderName(),
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
            'activated_at' => $this->activated_at?->format('Y-m-d H:i:s'),
            'deleted_at' => $this->deleted_at?->format('Y-m-d H:i:s'),
            'url' => "/posts/{$this->hash}",
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
            return app(YoutubeThumbnailService::class)->ensure($this->resource);
        }

        return $this->imageThumbnailUrl();
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
}
