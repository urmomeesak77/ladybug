<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\Role;
use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The comment query layer plus the create/hide/unhide/delete transitions. Reads are
 * viewer-aware — guests and members see only public rows, an admin+ additionally sees
 * hidden rows flagged — but the public count is always the non-hidden total regardless of
 * viewer (data-model D6/D7). The write transitions mirror ModerationService's locked
 * state-guard pattern so repeated/concurrent actions converge (contracts concurrency).
 */
class CommentService {
    /** One newest-first batch per request (FR-019). */
    private const PER_PAGE = 10;

    /**
     * One newest-first batch of the post's comments plus the public count and the
     * older-comments cursor. `created_at DESC, id DESC` is the stable newest-first key;
     * `$before` is the previous batch's `next_cursor` (a comment hash) and pages strictly
     * older. Hidden rows are included only for an admin+ viewer.
     *
     * @return array{comments: \Illuminate\Support\Collection<int, Comment>, total: int, next_cursor: ?string, has_more: bool}
     */
    public function list(Trashpost $post, ?string $before, ?User $viewer): array {
        $query = $post->comments()->with('user')->orderByDesc('created_at')->orderByDesc('id');
        if (!$this->seesHidden($viewer)) {
            $query->whereNull('hidden_at');
        }
        $this->applyCursor($post, $query, $before);

        // Fetch one extra row to learn whether an older batch exists without a second query.
        $rows = $query->limit(self::PER_PAGE + 1)->get();
        $hasMore = $rows->count() > self::PER_PAGE;
        $comments = $rows->take(self::PER_PAGE)->values();

        return [
            'comments' => $comments,
            // Always the PUBLIC count (hidden_at IS NULL) — an admin viewer who can see
            // hidden rows still reads the count the public would see (FR-015, D7).
            'total' => $post->comments()->whereNull('hidden_at')->count(),
            'next_cursor' => $hasMore ? $comments->last()->hash : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Whether this viewer receives hidden comments — an admin or higher only. A guest
     * (null) and a member never do (contracts viewer-awareness).
     */
    private function seesHidden(?User $viewer): bool {
        return $viewer !== null && $viewer->role->rank() >= Role::Admin->rank();
    }

    /**
     * Restrict the batch to comments strictly older than the `$before` cursor's comment on
     * (created_at, id). An unknown/blank cursor is ignored (newest batch). The OR-form keyset
     * (not `created_at < c AND id < c.id`) so a comment created at the same instant but with a
     * smaller id is not skipped — the same keyset shape the feed uses. Values are bound.
     *
     * @param  HasMany<Comment, Trashpost>  $query
     */
    private function applyCursor(Trashpost $post, HasMany $query, ?string $before): void {
        if ($before === null || $before === '') {
            return;
        }
        $cursor = $post->comments()->where('hash', $before)->first();
        if ($cursor === null) {
            return;
        }
        $query->whereRaw(
            '(created_at < ? or (created_at = ? and id < ?))',
            [$cursor->created_at, $cursor->created_at, $cursor->id],
        );
    }
}
