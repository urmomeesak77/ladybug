<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\Role;
use App\Models\Trashpost;
use App\Models\User;

/**
 * The single owner of every rating adjustment. Nothing else in the codebase writes
 * `users.rating` — the column is out of $fillable precisely so this class is the only
 * path to it (FR-003).
 *
 * The rating is state-reflective (design 2026-07-21): each method moves the owner by a
 * fixed ±1 and carries no per-meme bookkeeping. Whether a transition should move the
 * rating at all is decided by the state guards in the caller (ModerationService), which
 * lock the meme row so a repeated or concurrent transition converges to a single delta.
 * This class only applies the delta — saturating at the column bounds and charging
 * nobody when the meme has no owner.
 */
class RatingService {
    /** An account at or above this rating publishes without waiting for a moderator (FR-016). */
    public const TRUST_THRESHOLD = 15;

    /**
     * The saturation bounds (FR-011a). These are the signed-smallint range of the
     * `users.rating` column created in `2026_07_20_000000_add_rating_to_users_table.php`.
     * Nothing in the type system ties them to that column, so widening or narrowing the
     * migration's `smallInteger` without changing these would silently let a rating
     * overflow instead of saturating.
     */
    public const MIN = -32768;
    public const MAX = 32767;

    /**
     * Whether this account's next upload publishes without waiting for a moderator
     * (FR-016). Read BEFORE the upload exists, so the +1 that upload may earn can
     * never push its own author over the line (FR-020).
     *
     * Moderators skip the queue on role alone, whatever their rating (FR-017) — the
     * queue is theirs to clear, so making them wait in it serves nobody. The role half
     * reuses the shipped comparison rather than naming Admin and Superuser separately:
     * "Admin does not outrank you" is true for exactly those two and false for a member,
     * and it stays correct if a rank is ever added above Superuser.
     */
    public function shouldAutoActivate(User $user): bool {
        return ! Role::Admin->outranks($user->role) || $user->rating >= self::TRUST_THRESHOLD;
    }

    /**
     * Activation credit: the newly-live meme earns its owner +1 (FR-005). The caller
     * fires this only on a real inactive→active transition, so repeats cannot compound.
     */
    public function credit(Trashpost $post): void {
        $this->adjust($post->user_id, 1);
    }

    /**
     * Release an activation credit on deactivation: −1 (FR-005). The caller guards this
     * on the meme actually having been active, so a never-activated meme is never charged.
     */
    public function releaseCredit(Trashpost $post): void {
        $this->adjust($post->user_id, -1);
    }

    /**
     * The deletion penalty: −1 (FR-007). The caller fires this only on a real
     * live→trashed transition, so a repeated delete costs nothing further.
     */
    public function penalize(Trashpost $post): void {
        $this->adjust($post->user_id, -1);
    }

    /**
     * Give back the deletion penalty on restore: +1 (FR-010). Fired only on a real
     * trashed→live transition.
     */
    public function refund(Trashpost $post): void {
        $this->adjust($post->user_id, 1);
    }

    /**
     * Settle a meme's rating before its row is destroyed (FR-009). Purge always costs
     * the owner exactly −1, whatever the meme's state (design 2026-07-21).
     */
    public function settlePurge(Trashpost $post): void {
        $this->adjust($post->user_id, -1);
    }

    /**
     * Move one account's rating by $delta, saturating at the column's bounds. A null
     * owner is a no-op (FR-012). Runs inside the caller's transaction so the rating and
     * the state change it settles commit or roll back together (FR-013).
     *
     * The owner row is locked and the rating clamped (not a bare atomic increment) so the
     * read-modify-write can saturate at the bounds (FR-011a) without a race.
     */
    private function adjust(?int $userId, int $delta): void {
        if ($userId === null) {
            return;
        }
        // The FK is nullOnDelete, so a non-null user_id always resolves; a miss is a
        // broken invariant and must surface rather than silently skip the adjustment.
        $user = User::whereKey($userId)->lockForUpdate()->firstOrFail();
        $user->rating = max(self::MIN, min(self::MAX, $user->rating + $delta));
        $user->save();
    }
}
