<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

class TrashpostService {
    private const DEFAULT_LIMIT = 10;

    private const MAX_LIMIT = 50;

    /**
     * The newest visible posts, newest-first, as a bounded keyset page.
     *
     * @param  array<string, mixed>  $query  Request query: optional `limit` and `start`.
     * @return Collection<int, Trashpost>
     */
    public function feed(array $query): Collection {
        $builder = $this->visible()
            ->orderByDesc('activated_at')
            ->orderByDesc('id')
            ->limit($this->resolveLimit($query['limit'] ?? null));

        $this->applyCursor($builder, $query['start'] ?? null);

        return $builder->get();
    }

    /**
     * Base query for publicly visible posts: activated and (via SoftDeletes) not trashed.
     */
    private function visible(): Builder {
        return Trashpost::query()->whereNotNull('activated_at');
    }

    /**
     * Clamp the requested limit to [1, 50]; non-numeric or non-positive falls back to 10.
     */
    private function resolveLimit(mixed $limit): int {
        if (!is_numeric($limit) || (int) $limit < 1) {
            return self::DEFAULT_LIMIT;
        }

        return min((int) $limit, self::MAX_LIMIT);
    }

    /**
     * Restrict the feed to posts strictly older than the `start` cursor's post.
     *
     * Unknown/malformed cursors are ignored (newest page). The keyset is the OR-form
     * on (activated_at, id) — the flat `activated_at < c AND id < c.id` gaps on
     * posts activated earlier but inserted later (larger id).
     */
    private function applyCursor(Builder $builder, mixed $start): void {
        if (!is_string($start) || $start === '') {
            return;
        }

        $cursor = Trashpost::query()->where('hash', $start)->first();
        if ($cursor === null) {
            return;
        }

        // Keyset: posts strictly older than the cursor on (activated_at, id) —
        // activated earlier, or at the same instant with a smaller id; not the
        // flat `activated_at < c AND id < c.id`, which would skip posts activated
        // earlier but inserted later (larger id).
        //
        // The OR-form (not the equivalent row-value `(activated_at, id) < (?, ?)`)
        // is deliberate: verified via EXPLAIN ANALYZE on MySQL 8, only the OR-form
        // is optimized into a backward range *seek* on trashposts_feed_index
        // (~10 index rows/page); the row-value form degrades to scanning the whole
        // newer prefix and filtering. Values are bound as parameters.
        $builder->whereRaw(
            '(activated_at < ? or (activated_at = ? and id < ?))',
            [$cursor->activated_at, $cursor->activated_at, $cursor->id],
        );
    }
}
