<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Comment
 */
class CommentResource extends JsonResource {
    /**
     * The public shape of a comment: its own `hash` handle, body, author display name, the
     * hidden flag, and the post time.
     *
     * Deliberately omitted: the DB `id`, `trashpost_id`, `user_id`, `hidden_at`, and
     * `updated_at` — internal bookkeeping; the `hash` is the public identifier (Principle V).
     * `hidden` only ever reaches an admin viewer — guests and members never receive hidden
     * rows, so for them it is always false (contracts, data-model D6/D7).
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        return [
            'hash' => $this->hash,
            'body' => $this->body,
            'username' => $this->authorName(),
            'hidden' => $this->isHidden(),
            'created_at' => $this->created_at,
        ];
    }

    /**
     * The author's account name when the account still resolves, else the name snapshotted on
     * the row at creation — an orphaned comment still shows who wrote it (data-model D5). Same
     * rule as TrashpostResource::authorName so both surfaces agree.
     */
    private function authorName(): ?string {
        return $this->user?->name ?? $this->username;
    }
}
