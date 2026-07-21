<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The back-office account query layer: the paged, all-states list the admin user console
 * reads. Unlike any public surface it hides nothing — every account is listed regardless of
 * role, verification, or disabled state, so an admin sees the whole roster. It also owns the
 * disable/enable transitions: each writes ONLY the two disabled_* columns (access revocation
 * only — never content, activation, or rating; research D9), and only when the acting account
 * strictly outranks the target (peer, higher-rank and self all refused; research D5).
 */
class UserAdminService {
    /** Back-office page size (FR-006a): the table pages 100 accounts at a time. */
    private const PER_PAGE = 100;

    /**
     * One page of every account, newest-first. `created_at` is the primary sort key with
     * `id` as a stable tiebreak so same-instant rows keep a deterministic order across
     * pages. The disabling actor is eager-loaded for the row's disabled_by column, so a
     * page of 100 disabled rows costs one extra query, not a hundred.
     *
     * @return LengthAwarePaginator<int, User>
     */
    public function paginate(int $page): LengthAwarePaginator {
        return User::with('disabledBy')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $page);
    }

    /**
     * Revoke an account's access (FR-008). Set-to-target: an already-disabled account is left
     * exactly as it was, so a repeat or concurrent disable neither churns the timestamp nor
     * reassigns the actor.
     */
    public function disable(User $actor, string $hash): User {
        return $this->transition($actor, $hash, disable: true);
    }

    /**
     * Restore an account's access (FR-009). Idempotent: an active account is a no-op.
     */
    public function enable(User $actor, string $hash): User {
        return $this->transition($actor, $hash, disable: false);
    }

    /**
     * Load the target fresh inside a transaction and, only on a real state change, write the
     * two disabled_* columns together — nothing else (research D9). `disable` names the target
     * state, not a toggle, so repeated calls converge without churn. Missing hash → 404.
     *
     * The strict-rank guard runs first, against the freshly loaded rows: an actor may act only
     * on accounts ranked strictly below their own. Because a role never outranks itself, this
     * one comparison delivers the peer, higher-rank AND self-lockout guards together, on the
     * CURRENT stored role (not a stale rendered one) — refusal leaves the target untouched
     * (FR-011/FR-012, research D5).
     */
    private function transition(User $actor, string $hash, bool $disable): User {
        DB::beginTransaction();
        try {
            $target = User::where('hash', $hash)->lockForUpdate()->firstOrFail();
            if (! $actor->role->outranks($target->role)) {
                abort(403);
            }
            if ($disable && ! $target->isDisabled()) {
                $target->disabled_at = now();
                $target->disabled_by = $actor->id;
                $target->save();
            }
            elseif (! $disable && $target->isDisabled()) {
                $target->disabled_at = null;
                $target->disabled_by = null;
                $target->save();
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        // Resolve the actor's NAME for the response row (AdminUserResource reads disabledBy),
        // reflecting the stored actor — the original one on a no-op repeat.
        return $target->load('disabledBy');
    }
}
