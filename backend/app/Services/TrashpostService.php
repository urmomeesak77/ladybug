<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\Role;
use App\Exceptions\UploadStagingFailed;
use App\Jobs\FetchYoutubeThumbnail;
use App\Jobs\ProcessPostMedia;
use App\Models\Trashpost;
use App\Models\User;
use App\Utils\Str;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class TrashpostService {
    private const DEFAULT_LIMIT = 10;

    private const MAX_LIMIT = 50;

    /** Retries for the astronomically rare public-hash collision (unique column). */
    private const MAX_HASH_ATTEMPTS = 3;

    /** Where a validated upload waits for the queue worker, on the private `local` disk. */
    private const STAGING_DIR = 'staging';

    public function __construct(
        private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor(),
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
     * The same keyset page as feed(), without the uploader or the comment count.
     *
     * For the crawlable shell body (ShellController), which reads neither: it runs on every
     * home-page visit, so the eager-load query and the correlated count per row were pure
     * overhead there. $limit is the caller's own, already clamped page size.
     *
     * @return Collection<int, Trashpost>
     */
    public function leanFeed(int $limit, ?string $start): Collection {
        $builder = $this->visible()
            ->orderByDesc('activated_at')
            ->orderByDesc('id')
            ->limit($limit);

        $this->applyCursor($builder, $start);

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
        if ($post->isPubliclyVisible()) {
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
     * Create a post from an already-validated upload: an image file, a video file, or a
     * parsed YouTube id.
     *
     * The hash row is reserved (saved) BEFORE anything is written, so a hash collision can
     * never overwrite another post's media — it just retries with a fresh hash.
     *
     * An image or video is only STAGED here and handed to the queue worker (024): resizing,
     * re-packaging and frame extraction would otherwise hold one of the three request workers
     * for seconds. The post is `processing` — never public — until processStaged() makes it
     * `ready`, and that is also where a trusted uploader's post is activated. A YouTube post
     * has no media to process, so it is ready at once and activated here as before; only its
     * still is fetched in the background.
     */
    public function createPost(User $user, ?string $title, ?UploadedFile $image, ?string $youtubeId, ?UploadedFile $video = null, bool $isShort = false): Trashpost {
        // Read the uploader's standing BEFORE the post exists, so the credit this very
        // upload may earn cannot push its own author over the threshold (FR-020).
        $autoActivate = $this->rating->shouldAutoActivate($user);
        $post = $this->reserve($user, $title, $youtubeId, $isShort);
        $upload = $image ?? $video;
        if ($upload !== null) {
            $this->stage($post, $upload);
            ProcessPostMedia::dispatch((string) $post->hash, $autoActivate);

            // fresh(): under the `sync` driver (tests, e2e) the job has already run.
            return $post->fresh() ?? $post;
        }

        FetchYoutubeThumbnail::dispatch((string) $post->hash);
        if ($autoActivate) {
            $this->activate($post);
        }

        return $post->fresh() ?? $post;
    }

    /**
     * The queue worker's half of an upload (ProcessPostMedia): run the SAME processors the
     * request used to run inline, then — in one locked transaction — make the post ready and,
     * for a trusted uploader, activate and credit it.
     *
     * Safe to run again after an interruption (FR-016): anything but a `processing` post is
     * left alone, and leftovers of an earlier attempt are discarded first. A file that cannot
     * be processed ends `failed` and is NOT rethrown — it would fail identically on a retry.
     */
    public function processStaged(string $hash, bool $autoActivate): void {
        $post = $this->processingPost($hash);
        $source = $post === null ? null : $this->stagedUpload($post);
        if ($post === null || $source === null) {
            if ($post !== null) {
                $this->markFailed($post);
            }

            return;
        }

        $processor = $this->processorFor($source);
        $processor->discard($hash, $source);
        try {
            $fields = $processor->process($source, $hash);
        }
        catch (Throwable $e) {
            report($e);
            $processor->discard($hash, $source);
            $this->markFailed($post);

            return;
        }

        $this->completeProcessing($post, $fields, $autoActivate, $processor, $source);
    }

    /**
     * The job gave up (the worker died on every delivery): leave the post `failed` with no
     * partial files, exactly as a processing error would. A post that already finished, or
     * no longer exists, is left alone.
     */
    public function failStaged(string $hash): void {
        $post = $this->processingPost($hash);
        if ($post === null) {
            return;
        }
        $source = $this->stagedUpload($post);
        if ($source !== null) {
            $this->processorFor($source)->discard($hash, $source);
        }
        $this->markFailed($post);
    }

    /** The post behind a staged upload, but only while it is still waiting to be processed. */
    private function processingPost(string $hash): ?Trashpost {
        $post = Trashpost::withTrashed()->where('hash', $hash)->first();

        return $post !== null && $post->media_state === Trashpost::MEDIA_PROCESSING ? $post : null;
    }

    /**
     * Keep the validated upload on the private disk for the worker — PHP deletes its own temp
     * file when the request ends. A failed write removes the reserved row and raises
     * UploadStagingFailed before anything is dispatched (024 contract: 503, nothing created).
     */
    private function stage(Trashpost $post, UploadedFile $upload): void {
        try {
            $stored = Storage::disk('local')->putFileAs(self::STAGING_DIR, $upload, (string) $post->hash);
        }
        catch (Throwable) {
            $stored = false;
        }
        if (! is_string($stored)) {
            $post->forceDelete();
            throw new UploadStagingFailed("Could not stage the upload for {$post->hash}.");
        }

        $post->media_state = Trashpost::MEDIA_PROCESSING;
        $post->media_source = $stored;
        $post->save();
    }

    /**
     * The ready transition, under a row lock so a concurrent purge or a re-delivered job
     * cannot interleave with it. A post purged while its media was being made gets that media
     * removed again; a soft-deleted one gets its media but is not brought back to life.
     *
     * @param  array<string, string>  $fields
     */
    private function completeProcessing(Trashpost $post, array $fields, bool $autoActivate, TrashpostImageProcessor|TrashpostVideoProcessor $processor, UploadedFile $source): void {
        DB::beginTransaction();
        try {
            $locked = Trashpost::withTrashed()->lockForUpdate()->find($post->id);
            if ($locked !== null && $locked->media_state === Trashpost::MEDIA_PROCESSING) {
                $this->markReady($locked, $fields, $autoActivate && ! $locked->trashed());
            }
            DB::commit();
        }
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        if ($locked === null) {
            $processor->discard((string) $post->hash, $source);
        }
        $this->deleteStaged($post);
        $this->meta->forget((string) $post->hash);
    }

    /** @param  array<string, string>  $fields */
    private function markReady(Trashpost $post, array $fields, bool $shouldActivate): void {
        $post->fill($fields);
        $post->media_state = Trashpost::MEDIA_READY;
        $post->media_source = null;
        if ($shouldActivate) {
            $post->activated_at = now();
        }
        $post->save();
        if ($shouldActivate) {
            $this->rating->credit($post);
        }
    }

    private function markFailed(Trashpost $post): void {
        $this->deleteStaged($post);
        $post->media_state = Trashpost::MEDIA_FAILED;
        $post->media_source = null;
        $post->save();
    }

    private function deleteStaged(Trashpost $post): void {
        Storage::disk('local')->delete(self::STAGING_DIR . '/' . $post->hash);
    }

    /**
     * The staged file presented as an upload, so the processors run on it exactly as they
     * ran on the request's own file. Its MIME is read from the bytes, never from a name.
     */
    private function stagedUpload(Trashpost $post): ?UploadedFile {
        $disk = Storage::disk('local');
        if ($post->media_source === null || ! $disk->exists($post->media_source)) {
            return null;
        }

        return new UploadedFile($disk->path($post->media_source), (string) $post->hash, null, null, true);
    }

    private function processorFor(UploadedFile $source): TrashpostImageProcessor|TrashpostVideoProcessor {
        return str_starts_with((string) $source->getMimeType(), 'video/') ? $this->videos : $this->images;
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
    private function reserve(User $user, ?string $title, ?string $youtubeId, bool $isShort): Trashpost {
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
            $post->youtube_is_short = $isShort;
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
