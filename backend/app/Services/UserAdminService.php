<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

/**
 * The back-office account query layer: the paged, all-states list the admin user console
 * reads. Unlike any public surface it hides nothing — every account is listed regardless of
 * role, verification, or disabled state, so an admin sees the whole roster. The disable and
 * enable transitions (with the strict-rank guard) land here in US3/US4.
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
}
