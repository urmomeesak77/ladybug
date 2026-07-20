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
 * The back-office moderation query layer: the paged, all-states feed the admin table reads.
 * Unlike the public feed it hides nothing — soft-deleted and never-activated memes are
 * included (withTrashed, no activation filter) so an admin can see and act on the whole
 * corpus. The four state transitions land here in US3/US4, and each also syncs the meme's
 * media to the disk matching its new visibility — soft-deleting/deactivating pulls files off
 * the public disk, restoring/activating puts them back. Purge (hard delete) removes the row
 * and its media files for good, from both disks.
 */
class ModerationService {
    /** Back-office page size (spec FR-003): the table pages 100 rows at a time. */
    private const PER_PAGE = 100;

    public function __construct(
        private readonly MediaVisibilityService $media = new MediaVisibilityService(),
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
            // Credit only on a real transition, so a repeated activate is +1 in total
            // (FR-014) and re-activating an already-live legacy meme cannot mint a
            // credit it never held (SC-005 caps legacy memes at 0).
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
        $this->media->sync($post);

        return $post;
    }

    /**
     * Clear a meme's activation. Idempotent: already-inactive stays null.
     */
    public function deactivate(string $hash): Trashpost {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            // Release BEFORE clearing activated_at: RatingService reads "was this meme
            // live?" to charge legacy memes that hold no credit flag (FR-002, SC-005).
            $this->rating->releaseCredit($post);
            $post->activated_at = null;
            $post->save();
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        $this->media->sync($post);

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
            if (!$post->trashed()) {
                $post->delete();
            }
            // Flag-guarded, so a repeat delete costs nothing further (FR-008).
            $this->rating->penalize($post);
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        $this->media->sync($post);

        return $post;
    }

    /**
     * Undelete a soft-deleted meme. Idempotent: a live meme stays live.
     */
    public function restore(string $hash): Trashpost {
        DB::beginTransaction();
        try {
            $post = $this->find($hash);
            if ($post->trashed()) {
                $post->restore();
            }
            $this->rating->refund($post);
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        $this->media->sync($post);

        return $post;
    }

    /**
     * Hard-delete a meme: remove the DB row for good, then its media files from BOTH
     * disks — a soft-deleted meme's files live on the private disk by the time purge
     * runs. The file list is computed before the row goes away; the row is removed
     * FIRST so a failed file cleanup can only leave invisible orphan files — never a
     * live row pointing at deleted media. Storage::delete() tolerates missing files.
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
     */
    private function find(string $hash): Trashpost {
        return Trashpost::withTrashed()->where('hash', $hash)->firstOrFail();
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
