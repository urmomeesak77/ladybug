<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Trashpost
 */
class TrashpostResource extends JsonResource {
    /**
     * Serialize the stored fields plus the shareable frontend URL and the API URL.
     * Image-size keys (`original`/`default`/`sizes`) are layered in by US3.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
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
        ];
    }
}
