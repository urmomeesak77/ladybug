<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Storage;

/**
 * The back-office moderation query layer: the paged, all-states feed the admin table reads.
 * Unlike the public feed it hides nothing — soft-deleted and never-activated memes are
 * included (withTrashed, no activation filter) so an admin can see and act on the whole
 * corpus. The four state transitions land here in US3/US4. Purge (hard delete) removes the
 * row and its media files for good.
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
     * Hard-delete a meme: remove the DB row for good, then its media files. The file list
     * is computed before the row goes away; the row is removed FIRST so a failed file
     * cleanup can only leave invisible orphan files — never a live row pointing at deleted
     * media. Storage::delete() tolerates already-missing files.
     */
    public function purge(string $hash): void {
        $post = $this->find($hash);
        $paths = $this->purgeablePaths($post);
        $post->forceDelete();
        Storage::disk('public')->delete($paths);
    }

    /**
     * Every file the meme owns outright: all image size variants of its stored file, plus
     * its YouTube thumbnail only when no other post (trashed included) shares that file —
     * thumbnails are stored once per video id.
     *
     * @return list<string>
     */
    private function purgeablePaths(Trashpost $post): array {
        $paths = [];
        if ($post->file !== null) {
            $code = pathinfo($post->file, PATHINFO_FILENAME);
            $ext = pathinfo($post->file, PATHINFO_EXTENSION);
            foreach (MediaPath::imageSizes() as $size) {
                $paths[] = MediaPath::imageRelativePath($size, $code, $ext);
            }
        }
        if ($post->youtube_thumbnail !== null && !$this->thumbnailShared($post)) {
            $paths[] = $post->youtube_thumbnail;
        }

        return $paths;
    }

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }

    /**
     * Resolve a meme by its public hash, including soft-deleted ones so a trashed meme is
     * still reachable for a state change (contract lookup semantics). Missing → 404.
     */
    private function find(string $hash): Trashpost {
        return Trashpost::withTrashed()->where('hash', $hash)->firstOrFail();
    }
}
