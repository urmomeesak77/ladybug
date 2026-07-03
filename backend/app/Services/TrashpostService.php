<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Models\User;
use App\Utils\Str;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Throwable;

class TrashpostService {
    private const DEFAULT_LIMIT = 10;

    private const MAX_LIMIT = 50;

    /** Retries for the astronomically rare public-hash collision (unique column). */
    private const MAX_HASH_ATTEMPTS = 3;

    public function __construct(private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor()) {
    }

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
     * The single visible post with this public hash, or null when none matches.
     *
     * Reuses the visibility builder, so hidden (not activated), soft-deleted, and
     * unknown hashes all resolve to null — the controller maps that to a 404.
     */
    public function findVisibleByHash(string $hash): ?Trashpost {
        return $this->visible()->where('hash', $hash)->first();
    }

    /**
     * Create a post from an already-validated upload: an image file or a parsed YouTube id.
     *
     * The hash row is reserved (saved) BEFORE any file is written, so a hash collision can
     * never overwrite another post's media — it just retries with a fresh hash. YouTube
     * posts activate on the spot; image posts activate only after their files exist.
     */
    public function createPost(User $user, ?string $title, ?UploadedFile $image, ?string $youtubeId): Trashpost {
        $post = $this->reserve($user, $title, $youtubeId, $image === null);
        if ($image !== null) {
            $this->attachImage($post, $image);
        }

        return $post;
    }

    /**
     * Persist the row that claims a public hash, retrying on the unique-constraint
     * collision (same pattern as UserService::create).
     */
    private function reserve(User $user, ?string $title, ?string $youtubeId, bool $activate): Trashpost {
        for ($attempt = 1; ; $attempt++) {
            $post = new Trashpost([
                'hash' => $this->mintHash(),
                'title' => $title,
                'user_id' => $user->id,
                'username' => $user->name,
                'type' => $youtubeId === null ? null : 'youtube',
                'youtube' => $youtubeId,
            ]);
            if ($activate) {
                $post->activated_at = now();
            }
            try {
                $post->save();

                return $post;
            }
            catch (UniqueConstraintViolationException $e) {
                if ($attempt >= self::MAX_HASH_ATTEMPTS) {
                    throw $e;
                }
            }
        }
    }

    /**
     * Write the image files for a reserved post, then activate it. On failure the reserved
     * row and any files already written are removed — no orphaned media, no invisible
     * half-created row — and the failure is rethrown for the framework's error handling.
     */
    private function attachImage(Trashpost $post, UploadedFile $image): void {
        try {
            $post->fill($this->images->process($image, $post->hash));
            $post->activated_at = now();
            $post->save();
        }
        catch (Throwable $e) {
            $this->images->discard($post->hash, $image);
            $post->forceDelete();
            throw $e;
        }
    }

    /**
     * Mint a candidate public hash. Protected so collision tests can substitute a
     * deterministic sequence; production always delegates to Str::createUniqueHash.
     */
    protected function mintHash(): string {
        return Str::createUniqueHash();
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
