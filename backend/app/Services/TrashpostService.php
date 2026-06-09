<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use Closure;
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

        // Wrap the OR group so it cannot escape the visibility filter.
        $builder->where($this->strictlyOlderThan($cursor));
    }

    /**
     * Group predicate selecting posts strictly older than $cursor on the
     * (activated_at, id) keyset: either activated earlier, or activated at the
     * same instant but with a smaller id. The OR-form (not a flat
     * `activated_at < c AND id < c.id`) keeps posts activated earlier yet
     * inserted later — larger id — from being skipped.
     */
    private function strictlyOlderThan(Trashpost $cursor): Closure {
        $activatedAt = $cursor->activated_at;
        $id = $cursor->id;

        return static function (Builder $group) use ($activatedAt, $id): void {
            $group->where('activated_at', '<', $activatedAt)
                ->orWhere(static fn (Builder $tie): Builder => $tie
                    ->where('activated_at', '=', $activatedAt)
                    ->where('id', '<', $id));
        };
    }
}
