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
}
