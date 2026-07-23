<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\Role;
use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use App\Utils\Str;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Throwable;

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

    /** Retries for the astronomically rare public-hash collision (unique column). */
    private const MAX_HASH_ATTEMPTS = 3;

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
     * Create a comment on the post, attributed to the author and immediately public. Identity
     * and ownership are assigned explicitly, never mass-assigned — $fillable stays limited to
     * `body` so no request body can smuggle a hash/user_id/hidden_at (mass-assignment guard,
     * Principle VI). The author's current name is snapshotted so an orphaned comment still
     * shows who wrote it (data-model D5). Retries on the unique-hash collision (as reserve()).
     */
    public function create(Trashpost $post, User $author, string $body): Comment {
        for ($attempt = 1; ; $attempt++) {
            $comment = new Comment();
            $comment->hash = $this->mintHash();
            $comment->trashpost_id = $post->id;
            $comment->user_id = $author->id;
            $comment->username = $author->name;
            $comment->body = $body;
            try {
                $comment->save();

                return $comment;
            }
            catch (UniqueConstraintViolationException $e) {
                if ($attempt >= self::MAX_HASH_ATTEMPTS) {
                    throw $e;
                }
            }
        }
    }

    /**
     * Hide a comment from public view (retained, still visible to admins). Set-to-target, not
     * toggle: an already-hidden comment keeps its original `hidden_at`, so repeated/concurrent
     * hides converge to a single settled state (contracts concurrency, mirrors ModerationService).
     */
    public function hide(Comment $comment): Comment {
        return $this->setHidden($comment, true);
    }

    /**
     * Restore a hidden comment to public view. Idempotent: an already-visible comment stays
     * visible (reversible with no residual effect, FR-012).
     */
    public function unhide(Comment $comment): Comment {
        return $this->setHidden($comment, false);
    }

    /**
     * Permanently remove the comment (hard delete — no SoftDeletes, D3). Supersedes the hidden
     * state: a hidden comment can still be deleted. Loads the row FOR UPDATE inside a transaction
     * (as the hide/unhide transitions) so a concurrent moderation action serialises cleanly; a
     * missing row is a 404-worthy ModelNotFoundException. Irreversible once committed (FR-013).
     */
    public function delete(Comment $comment): void {
        DB::beginTransaction();
        try {
            Comment::where('id', $comment->id)->lockForUpdate()->firstOrFail()->delete();
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * Mint a candidate public hash. Protected so collision tests can substitute a deterministic
     * sequence; production always delegates to Str::createUniqueHash (as TrashpostService).
     */
    protected function mintHash(): string {
        return Str::createUniqueHash();
    }

    /**
     * Drive the comment to the target hidden state inside a transaction, against the row loaded
     * FOR UPDATE: the lock serialises concurrent transitions on the same comment so the guard
     * sees a settled state and a change cannot double-apply (ModerationService's locked find +
     * state-guard pattern). The write happens only on a real state change, so a repeat keeps the
     * original `hidden_at` timestamp.
     */
    private function setHidden(Comment $comment, bool $hidden): Comment {
        DB::beginTransaction();
        try {
            $locked = Comment::where('id', $comment->id)->lockForUpdate()->firstOrFail();
            if ($locked->isHidden() !== $hidden) {
                $locked->hidden_at = $hidden ? now() : null;
                $locked->save();
            }
            DB::commit();

            return $locked;
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
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
