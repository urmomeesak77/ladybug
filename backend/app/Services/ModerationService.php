<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * The back-office moderation query layer plus the four state transitions and purge. The
 * paged index hides nothing — soft-deleted and never-activated memes are included
 * (withTrashed, no activation filter) so an admin can see and act on the whole corpus.
 * Media stays on the public disk in every state (design 2026-07-21), so a transition only
 * changes row state and rating; purge (hard delete) additionally removes the row's media
 * files from disk for good.
 */
class ModerationService {
    /** Back-office page size (spec FR-003): the table pages 100 rows at a time. */
    private const PER_PAGE = 100;

    public function __construct(
        private readonly MediaOwnershipService $media = new MediaOwnershipService(),
        private readonly RatingService $rating = new RatingService(),
    ) {
    }

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
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            // Credit only on a real inactive→active transition, so repeated or concurrent
            // activates total +1, never more (design 2026-07-21).
            if ($post->activated_at === null) {
                $post->activated_at = now();
                $post->save();
                $this->rating->credit($post);
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $post;
    }

    /**
     * Clear a meme's activation. Idempotent: already-inactive stays null.
     */
    public function deactivate(string $hash): Trashpost {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            // Charge −1 only on a real active→inactive transition, so deactivating an
            // already-inactive meme is a no-op and repeats cannot compound (design
            // 2026-07-21). Release before clearing activated_at, both under one transaction.
            if ($post->activated_at !== null) {
                $this->rating->releaseCredit($post);
                $post->activated_at = null;
                $post->save();
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $post;
    }

    /**
     * Soft-delete a meme: it stays in the table (and its media on disk) but drops out of
     * every public view. Idempotent — an already-trashed meme keeps its original
     * `deleted_at`, so repeated/concurrent deletes converge without churn.
     */
    public function delete(string $hash): Trashpost {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            // Penalise only on a real live→trashed transition, so a repeat delete costs
            // nothing further (design 2026-07-21).
            if (!$post->trashed()) {
                $post->delete();
                $this->rating->penalize($post);
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $post;
    }

    /**
     * Undelete a soft-deleted meme. Idempotent: a live meme stays live.
     */
    public function restore(string $hash): Trashpost {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            // Refund only on a real trashed→live transition, so restoring an already-live
            // meme is a no-op (design 2026-07-21).
            if ($post->trashed()) {
                $post->restore();
                $this->rating->refund($post);
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $post;
    }

    /**
     * Hard-delete a meme: remove the DB row for good, then its media files from BOTH
     * disks — media now lives on the `public` disk in every state, but the `local` sweep
     * still reaps any legacy file the old move-on-hide code left behind. The file list is
     * computed before the row goes away; the row is removed FIRST so a failed file cleanup
     * can only leave invisible orphan files — never a live row pointing at deleted media.
     * Storage::delete() tolerates missing files.
     */
    public function purge(string $hash): void {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            $paths = $this->media->ownedPaths($post);
            // Settle BEFORE forceDelete: once the row is gone there is nothing left to
            // read the credit/penalty flags from, and the −2 would be lost with it.
            $this->rating->settlePurge($post);
            $post->forceDelete();
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        $this->deleteEverywhere($paths);
    }

    /**
     * Resolve a meme by its public hash, including soft-deleted ones so a trashed meme is
     * still reachable for a state change (contract lookup semantics). Missing → 404.
     *
     * The row is locked for update: every caller reads the meme's state to decide whether
     * a rating delta applies, and the lock serialises concurrent transitions on the same
     * meme so the guard sees a settled state and a delta cannot double-apply.
     */
    private function find(string $hash): Trashpost {
        return Trashpost::withTrashed()->where('hash', $hash)->lockForUpdate()->firstOrFail();
    }

    /**
     * Best-effort file cleanup after the row is gone. A failure cannot resurrect the
     * post, but an orphaned PUBLIC file stays fetchable, so every leftover is logged
     * loudly enough to be found and swept by hand.
     *
     * @param list<string> $paths
     */
    private function deleteEverywhere(array $paths): void {
        foreach (['public', 'local'] as $diskName) {
            $disk = Storage::disk($diskName);
            $disk->delete($paths);
            foreach ($paths as $path) {
                if ($disk->exists($path)) {
                    Log::warning('moderation.purge: could not delete file', ['disk' => $diskName, 'path' => $path]);
                }
            }
        }
    }
}
