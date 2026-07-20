<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The single owner of every rating adjustment. Nothing else in the codebase writes
 * `users.rating` — the column is out of $fillable precisely so this class is the only
 * path to it (FR-003).
 *
 * The design rests on two per-meme bookkeeping flags rather than on the meme's state
 * columns: `activated_at` says what a meme *is*, `rating_credited` says what has already
 * been *paid out* for it. Every delta is conditional on a flag actually changing, and
 * that one rule delivers no-drift across activate/deactivate cycles (FR-006), at most one
 * deletion penalty per meme (FR-008), and idempotency under repeats (FR-014) — instead of
 * three special cases.
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
     * Activation credit: the meme starts earning its owner +1 (FR-005). A second call
     * on an already-credited meme moves nothing (FR-006, FR-014).
     */
    public function credit(Trashpost $post): void {
        $this->settle($post, 'rating_credited', true, 1);
    }

    /**
     * Release an activation credit: the meme stops earning its +1 (FR-005).
     *
     * Charges on "was live", not on the credit flag alone. A meme activated before this
     * feature shipped holds no credit — every account's baseline is 0 (FR-002) — yet the
     * spec is explicit that deactivating one still costs the normal −1 (spec §Scope of the
     * model, Edge Cases, and SC-005's −2..0 attributable range for legacy memes). Keying
     * only on the flag would make those deactivations free, contradicting all three. A
     * meme that was never live is still a no-op, and the charge cannot repeat because the
     * caller clears `activated_at` in the same transaction.
     */
    public function releaseCredit(Trashpost $post): void {
        $this->settle($post, 'rating_credited', false, -1, chargeWhenLive: true);
    }

    /**
     * The single deletion penalty (FR-007). Once applied it never applies again unless
     * the meme is restored first (FR-008).
     */
    public function penalize(Trashpost $post): void {
        $this->settle($post, 'rating_penalized', true, -1);
    }

    /**
     * Give back the deletion penalty on restore (FR-010), leaving the meme penalizable
     * again should it be deleted a second time.
     */
    public function refund(Trashpost $post): void {
        $this->settle($post, 'rating_penalized', false, 1);
    }

    /**
     * Settle a meme's whole rating contribution before its row is destroyed (FR-009).
     * A live, credited meme costs its owner −2 here — the credit is released and the
     * deletion penalty applied at once — which still leaves its lifetime total at −1,
     * the same as every other route to deletion (US1 §9, SC-004).
     *
     * Nesting is deliberate: both calls open their own transaction, which Laravel
     * resolves to a savepoint inside the caller's, so the pair commits or rolls back
     * together whether or not a moderation transaction already encloses it.
     */
    public function settlePurge(Trashpost $post): void {
        $this->releaseCredit($post);
        $this->penalize($post);
    }

    /**
     * Write the flag and, when the flag actually moves, the matching rating delta —
     * atomically (FR-013). Rows are locked post-first-then-user, a fixed order, so two
     * moderators acting on two memes of the same owner cannot deadlock.
     *
     * An unowned meme books its flag and charges nobody (FR-012); the action still
     * succeeds. The rating is clamped rather than incremented, because a bare atomic
     * increment can neither saturate (FR-011a) nor read-check the flag in one statement.
     */
    private function settle(Trashpost $post, string $flag, bool $target, int $delta, bool $chargeWhenLive = false): void {
        DB::beginTransaction();
        try {
            // firstOrFail, not first: every call site holds a live row (purge settles
            // before forceDelete), so a miss is a broken invariant that must surface
            // and roll the enclosing transition back — never pass silently.
            $locked = Trashpost::withTrashed()->whereKey($post->getKey())->lockForUpdate()->firstOrFail();
            $charges = (bool) $locked->{$flag} !== $target
                || ($chargeWhenLive && $locked->activated_at !== null);
            $locked->{$flag} = $target;
            $locked->save();
            $post->{$flag} = $target;
            if ($charges) {
                $this->adjust($locked->user_id, $delta);
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * Move one account's rating by $delta, saturating at the column's bounds. A null
     * owner is a no-op (FR-012).
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
