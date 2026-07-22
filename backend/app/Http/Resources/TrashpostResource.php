<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Services\TrashpostImageService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

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

        return [
            'hash' => $this->hash,
            'title' => $this->title,
            'type' => $this->type,
            'file' => $this->file,
            'youtube' => $this->youtube,
            'username' => $this->authorName(),
            'metadata' => $this->metadata,
            'created_at' => $this->created_at,
            'activated_at' => $this->activated_at,
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
