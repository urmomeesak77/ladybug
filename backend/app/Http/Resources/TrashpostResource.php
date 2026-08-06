<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Services\TrashpostImageService;
use App\Support\MediaPath;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

/**
 * @mixin \App\Models\Trashpost
 */
class TrashpostResource extends JsonResource {
    /**
     * Serialize the public fields plus the shareable frontend URL, the API URL, and
     * the on-disk image URLs (`original`/`default`/`sizes`) resolved per post.
     *
     * Deliberately omitted: the DB `id` (the hash is the public identifier,
     * Principle V), `user_id`, `deleted_at`, `comment`, and `updated_at` — internal
     * bookkeeping that would leak posting volume, owner ids, schema details, and
     * internal edit/moderation timing for no client benefit.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        $image = app(TrashpostImageService::class)->imageData($this->resource);

        // The public (non-hidden) comment total, loaded via withCount at the query layer. The
        // `?? 0` covers the freshly-created post from store(), which is serialized without withCount.
        return [
            'hash' => $this->hash,
            'title' => $this->title,
            'type' => $this->type,
            'file' => $this->file,
            'video' => $this->videoUrl(),
            'youtube' => $this->youtube,
            'youtube_is_short' => (bool) $this->youtube_is_short,
            'username' => $this->authorName(),
            'metadata' => $this->metadata,
            'created_at' => $this->created_at,
            'activated_at' => $this->activated_at,
            'comment_count' => (int) ($this->comment_count ?? 0),
            'hidden' => $this->hiddenStatus(),
            'url' => "/posts/{$this->hash}",
            'url_api' => route('api.posts.show', ['hash' => $this->hash]),
            'original' => $image['original'],
            'default' => $image['default'],
            'sizes' => $image['sizes'],
        ];
    }

    /**
     * The uploader's account name when the owner still resolves, else the name stored on
     * the row at upload time — an orphaned or legacy post still shows who posted it. Same
     * rule as AdminTrashpostResource::uploaderName so both surfaces agree.
     */
    private function authorName(): ?string {
        return $this->user?->name ?? $this->username;
    }

    /**
     * The playable video file's public URL for a video post, else null. `original`/
     * `default`/`sizes` describe the poster (via TrashpostImageService, unchanged); this is
     * the one new field naming the actual video (contracts/api-posts.md 201 response).
     */
    private function videoUrl(): ?string {
        if ($this->type !== 'video' || $this->file === null) {
            return null;
        }

        $code = pathinfo($this->file, PATHINFO_FILENAME);
        $ext = pathinfo($this->file, PATHINFO_EXTENSION);

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->url(MediaPath::videoRelativePath($code, $ext));
    }

    /**
     * A coarse visibility status for a viewer allowed to see a hidden post: 'deleted' when
     * soft-deleted, else 'pending' when not activated, else null. Deliberately coarse — no
     * deleted_at timestamp — so no internal moderation timing leaks, and on the public feed
     * (every row activated and not trashed) it is always null.
     */
    private function hiddenStatus(): ?string {
        if ($this->trashed()) {
            return 'deleted';
        }
        if ($this->activated_at === null) {
            return 'pending';
        }

        return null;
    }
}
