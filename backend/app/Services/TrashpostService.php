<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\Role;
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
        private readonly PageMetaService $meta = new PageMetaService(),
        private readonly TrashpostVideoProcessor $videos = new TrashpostVideoProcessor(),
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
            ->with('user')
            ->withCount('publicComments as comment_count')
            ->orderByDesc('activated_at')
            ->orderByDesc('id')
            ->limit($this->resolveLimit($query['limit'] ?? null));

        $this->applyCursor($builder, $query['start'] ?? null);

        return $builder->get();
    }

    /**
     * The single post this viewer may open at its permalink, or null when none matches.
     *
     * A publicly visible post (activated, not trashed) is returned to anyone. Beyond that
     * an admin+ sees a post in any state, and the uploader sees their own post unless it is
     * soft-deleted — so a member can open their still-pending upload but not a deleted one.
     * Every other case (guest or non-owner on a hidden post) resolves to null → 404.
     */
    public function findViewableByHash(string $hash, ?User $viewer): ?Trashpost {
        $post = Trashpost::withTrashed()
            ->with('user')
            ->withCount('publicComments as comment_count')
            ->where('hash', $hash)
            ->first();
        if ($post === null) {
            return null;
        }
        if ($post->activated_at !== null && !$post->trashed()) {
            return $post;
        }
        if ($viewer === null) {
            return null;
        }
        // Admins see every state; the owner sees their own post unless it is trashed.
        if ($viewer->role->rank() >= Role::Admin->rank()) {
            return $post;
        }
        if ($post->user_id === $viewer->id && !$post->trashed()) {
            return $post;
        }

        return null;
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
    public function createPost(User $user, ?string $title, ?UploadedFile $image, ?string $youtubeId, ?UploadedFile $video = null): Trashpost {
        // Read the uploader's standing BEFORE the post exists, so the credit this very
        // upload may earn cannot push its own author over the threshold (FR-020).
        $autoActivate = $this->rating->shouldAutoActivate($user);
        $post = $this->reserve($user, $title, $youtubeId);
        if ($image !== null) {
            $this->attachImage($post, $image);
        }
        if ($video !== null) {
            $this->attachVideo($post, $video);
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

        // A pending meme's media stays on the public disk like everything else; it is
        // hidden from the public API by the activation filter, not by moving its bytes
        // (design 2026-07-21). A moderator can see it in the admin console.
        return $post;
    }

    /**
     * Publish an upload from a trusted account and pay its owner the same +1 a moderator's
     * activation would (FR-019). Both writes share one transaction (FR-013): a failed
     * credit must not leave an activated post whose owner was never paid.
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
        // The same FR-040 invalidation a moderator's activate performs: this path
        // publishes a meme too, and the permalink may already hold a cached generic
        // block from a request that arrived before the upload. After the commit, for
        // the reason ModerationService::forgetMetadata records.
        $this->meta->forget($post->hash);
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
     * Write the video + poster files for a reserved post and record them on the row. Mirrors
     * attachImage() exactly: on failure the reserved row and any files already written are
     * removed, and the failure is rethrown.
     */
    private function attachVideo(Trashpost $post, UploadedFile $video): void {
        try {
            $post->fill($this->videos->process($video, $post->hash));
            $post->save();
        }
        catch (Throwable $e) {
            $this->videos->discard($post->hash, $video);
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
     * Base query for publicly visible posts. The rule itself lives on the model
     * (Trashpost::scopePubliclyVisible) so the feed and the sitemap share one
     * definition rather than two copies that can drift.
     *
     * @return Builder<Trashpost>
     */
    private function visible(): Builder {
        return Trashpost::publiclyVisible();
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
