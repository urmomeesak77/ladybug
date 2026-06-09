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
     * Serialize the stored fields plus the shareable frontend URL, the API URL, and
     * the on-disk image URLs (`original`/`default`/`sizes`) resolved per post.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        $image = app(TrashpostImageService::class)->imageData($this->resource);

        return [
            'id' => $this->id,
            'hash' => $this->hash,
            'title' => $this->title,
            'type' => $this->type,
            'file' => $this->file,
            'youtube' => $this->youtube,
            'user_id' => $this->user_id,
            'username' => $this->username,
            'comment' => $this->comment,
            'metadata' => $this->metadata,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'activated_at' => $this->activated_at,
            'deleted_at' => $this->deleted_at,
            'url' => "/posts/{$this->hash}",
            'url_api' => route('api.posts.show', ['hash' => $this->hash]),
            'original' => $image['original'],
            'default' => $image['default'],
            'sizes' => $image['sizes'],
        ];
    }
}
