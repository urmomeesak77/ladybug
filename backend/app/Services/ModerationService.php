<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The back-office moderation query layer: the paged, all-states feed the admin table reads.
 * Unlike the public feed it hides nothing — soft-deleted and never-activated memes are
 * included (withTrashed, no activation filter) so an admin can see and act on the whole
 * corpus. The four state transitions land here in US3/US4.
 */
class ModerationService {
    /** Back-office page size (spec FR-003): the table pages 100 rows at a time. */
    private const PER_PAGE = 100;

    /**
     * One page of every meme in every state, newest-first. `created_at` is the primary
     * sort key with `id` as a stable tiebreak so same-instant rows keep a deterministic
     * order across pages. The owner is eager-loaded for the row's user column.
     *
     * @return LengthAwarePaginator<int, Trashpost>
     */
    public function paginate(int $page): LengthAwarePaginator {
        return Trashpost::withTrashed()
            ->with('user')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $page);
    }

    /**
     * Mark a meme activated (publicly eligible). Set-to-target, not toggle: an already
     * activated meme keeps its original `activated_at`, so repeated or concurrent calls
     * converge without churning the timestamp (contract idempotency).
     */
    public function activate(string $hash): Trashpost {
        $post = $this->find($hash);
        if ($post->activated_at === null) {
            $post->activated_at = now();
            $post->save();
        }

        return $post;
    }

    /**
     * Clear a meme's activation. Idempotent: already-inactive stays null.
     */
    public function deactivate(string $hash): Trashpost {
        $post = $this->find($hash);
        $post->activated_at = null;
        $post->save();

        return $post;
    }

    /**
     * Soft-delete a meme: it stays in the table (and its media on disk) but drops out of
     * every public view. Idempotent — an already-trashed meme keeps its original
     * `deleted_at`, so repeated/concurrent deletes converge without churn.
     */
    public function delete(string $hash): Trashpost {
        $post = $this->find($hash);
        if (!$post->trashed()) {
            $post->delete();
        }

        return $post;
    }

    /**
     * Undelete a soft-deleted meme. Idempotent: a live meme stays live.
     */
    public function restore(string $hash): Trashpost {
        $post = $this->find($hash);
        if ($post->trashed()) {
            $post->restore();
        }

        return $post;
    }

    /**
     * Resolve a meme by its public hash, including soft-deleted ones so a trashed meme is
     * still reachable for a state change (contract lookup semantics). Missing → 404.
     */
    private function find(string $hash): Trashpost {
        return Trashpost::withTrashed()->where('hash', $hash)->firstOrFail();
    }
}
