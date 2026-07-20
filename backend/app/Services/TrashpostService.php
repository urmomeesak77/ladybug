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
use Illuminate\Support\Facades\DB;
use Throwable;

class TrashpostService {
    private const DEFAULT_LIMIT = 10;

    private const MAX_LIMIT = 50;

    /** Retries for the astronomically rare public-hash collision (unique column). */
    private const MAX_HASH_ATTEMPTS = 3;

    public function __construct(
        private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor(),
        private readonly YoutubeThumbnailService $thumbnails = new YoutubeThumbnailService(),
        private readonly RatingService $rating = new RatingService(),
        private readonly MediaVisibilityService $media = new MediaVisibilityService(),
    ) {
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
     * never overwrite another post's media — it just retries with a fresh hash. The row is
     * reserved PENDING whatever the outcome, and activation is a separate, transactional
     * step once the media exists (FR-015): both media branches then reach the same single
     * decision point, and a post is never briefly live with no file behind it.
     */
    public function createPost(User $user, ?string $title, ?UploadedFile $image, ?string $youtubeId): Trashpost {
        // Read the uploader's standing BEFORE the post exists, so the credit this very
        // upload may earn cannot push its own author over the threshold (FR-020).
        $autoActivate = $this->rating->shouldAutoActivate($user);
        $post = $this->reserve($user, $title, $youtubeId);
        if ($image !== null) {
            $this->attachImage($post, $image);
        }
        if ($youtubeId !== null) {
            // Fetch the still while the video id is fresh — one post, one request —
            // instead of lazily inside the admin index GET, where a page of 100 new
            // YouTube rows would stack 100 sequential 5s downloads. Best-effort:
            // ensure() reports-and-returns-null on failure, never failing the upload.
            $this->thumbnails->ensure($post);
        }
        if ($autoActivate) {
            $this->activate($post);

            return $post;
        }
        // Pending media must physically leave the public disk. Both the image variants
        // and the YouTube still are written there unconditionally, so without this a
        // pending meme would be hidden from the API while its bytes stayed fetchable by
        // hash — a moderation bypass, and exactly what MediaVisibilityService exists to
        // close. It runs here, after BOTH media branches, because the thumbnail lands
        // last; syncing any earlier would leave it behind.
        $this->media->sync($post);

        return $post;
    }

    /**
     * Publish an upload from a trusted account and pay its owner the same +1 a moderator's
     * activation would (FR-019). Both writes share one transaction (FR-013): a failed
     * credit must not leave a live post that can never be credited, since the flag would
     * then bar the +1 forever.
     */
    private function activate(Trashpost $post): void {
        DB::beginTransaction();
        try {
            $post->activated_at = now();
            $post->save();
            $this->rating->credit($post);
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * Persist the row that claims a public hash, retrying on the unique-constraint
     * collision (same pattern as UserService::create).
     */
    private function reserve(User $user, ?string $title, ?string $youtubeId): Trashpost {
        for ($attempt = 1; ; $attempt++) {
            // Identity and ownership are assigned explicitly, never mass-assigned —
            // $fillable stays limited to content fields so no future controller can
            // smuggle a hash/user_id through fill() (mass-assignment guard).
            $post = new Trashpost();
            $post->hash = $this->mintHash();
            $post->title = $title;
            $post->user_id = $user->id;
            $post->username = $user->name;
            $post->type = $youtubeId === null ? null : 'youtube';
            $post->youtube = $youtubeId;
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
     * Write the image files for a reserved post and record them on the row. On failure the
     * reserved row and any files already written are removed — no orphaned media, no
     * invisible half-created row — and the failure is rethrown for the framework's error
     * handling. Activation is decided by the caller, not here.
     */
    private function attachImage(Trashpost $post, UploadedFile $image): void {
        try {
            $post->fill($this->images->process($image, $post->hash));
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
