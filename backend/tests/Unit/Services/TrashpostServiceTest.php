<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\PageMetaService;
use App\Services\RatingService;
use App\Services\TrashpostImageProcessor;
use App\Services\TrashpostService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class TrashpostServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): TrashpostService {
        return new TrashpostService();
    }

    /**
     * A service whose protected mintHash() yields the given values in order, so
     * collision behaviour is testable without racing the real generator.
     */
    private function serviceMinting(TrashpostImageProcessor $processor, string ...$hashes): TrashpostService {
        $service = Mockery::mock(TrashpostService::class, [$processor])
            ->makePartial()
            ->shouldAllowMockingProtectedMethods();
        $service->shouldReceive('mintHash')->andReturn(...$hashes);

        return $service;
    }

    public function test_feed_returns_visible_posts_newest_first_by_activated_at(): void {
        $older = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);
        $newer = Trashpost::factory()->visible()->create(['activated_at' => now()]);

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$newer->id, $older->id], $ids);
    }

    public function test_feed_breaks_activated_at_ties_by_id_descending(): void {
        $at = now();
        $first = Trashpost::factory()->visible()->create(['activated_at' => $at]);
        $second = Trashpost::factory()->visible()->create(['activated_at' => $at]);

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$second->id, $first->id], $ids);
    }

    public function test_feed_defaults_to_ten_posts_per_page(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed([]));
    }

    public function test_feed_honors_a_valid_limit(): void {
        Trashpost::factory()->count(6)->visible()->create();

        $this->assertCount(3, $this->service()->feed(['limit' => 3]));
    }

    public function test_feed_clamps_limit_to_a_maximum_of_fifty(): void {
        Trashpost::factory()->count(51)->visible()->create();

        $this->assertCount(50, $this->service()->feed(['limit' => 999]));
    }

    public function test_feed_falls_back_to_default_for_non_numeric_limit(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed(['limit' => 'abc']));
    }

    public function test_feed_falls_back_to_default_for_non_positive_limit(): void {
        Trashpost::factory()->count(12)->visible()->create();

        $this->assertCount(10, $this->service()->feed(['limit' => 0]));
        $this->assertCount(10, $this->service()->feed(['limit' => -5]));
    }

    public function test_feed_cursor_returns_only_strictly_older_posts(): void {
        $newest = Trashpost::factory()->visible()->create(['activated_at' => now()]);
        $cursor = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);
        $older = Trashpost::factory()->visible()->create(['activated_at' => now()->subDays(2)]);

        $ids = $this->service()->feed(['start' => $cursor->hash])->pluck('id')->all();

        $this->assertSame([$older->id], $ids);
        $this->assertNotContains($newest->id, $ids);
        $this->assertNotContains($cursor->id, $ids);
    }

    public function test_feed_ignores_an_unknown_start_cursor(): void {
        Trashpost::factory()->count(3)->visible()->create();

        $this->assertCount(3, $this->service()->feed(['start' => '__nomatch__']));
    }

    public function test_feed_cursor_includes_an_older_post_with_a_larger_id(): void {
        // Proves the keyset is the OR-form, not the flat
        // `activated_at < cursor AND id < cursor.id`: this post is activated
        // earlier than the cursor yet has a LARGER id (inserted later), so the
        // flat predicate would wrongly drop it.
        $cursor = Trashpost::factory()->visible()->create(['activated_at' => now()]);
        $olderButLargerId = Trashpost::factory()->visible()->create(['activated_at' => now()->subDay()]);

        $this->assertGreaterThan($cursor->id, $olderButLargerId->id);

        $ids = $this->service()->feed(['start' => $cursor->hash])->pluck('id')->all();

        $this->assertContains($olderButLargerId->id, $ids);
    }

    public function test_feed_excludes_hidden_and_soft_deleted_posts(): void {
        $visible = Trashpost::factory()->visible()->create();
        Trashpost::factory()->hidden()->create();
        Trashpost::factory()->deleted()->create();

        $ids = $this->service()->feed([])->pluck('id')->all();

        $this->assertSame([$visible->id], $ids);
    }

    public function test_feed_returns_an_empty_collection_when_no_posts_are_visible(): void {
        Trashpost::factory()->hidden()->create();

        $this->assertTrue($this->service()->feed([])->isEmpty());
    }

    public function test_find_viewable_returns_a_public_post_for_a_guest(): void {
        $post = Trashpost::factory()->visible()->create();

        $found = $this->service()->findViewableByHash($post->hash, null);

        $this->assertNotNull($found);
        $this->assertSame($post->id, $found->id);
    }

    public function test_find_viewable_hides_a_pending_post_from_a_guest(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->assertNull($this->service()->findViewableByHash($post->hash, null));
    }

    public function test_find_viewable_hides_a_pending_post_from_a_non_owner_member(): void {
        $post = Trashpost::factory()->hidden()->create();
        $other = User::factory()->create();

        $this->assertNull($this->service()->findViewableByHash($post->hash, $other));
    }

    public function test_find_viewable_shows_a_pending_post_to_its_owner(): void {
        $owner = User::factory()->create();
        $post = Trashpost::factory()->hidden()->create(['user_id' => $owner->id]);

        $found = $this->service()->findViewableByHash($post->hash, $owner);

        $this->assertNotNull($found);
        $this->assertSame($post->id, $found->id);
    }

    public function test_find_viewable_shows_a_pending_post_to_an_admin(): void {
        $post = Trashpost::factory()->hidden()->create();
        $admin = User::factory()->admin()->create();

        $this->assertNotNull($this->service()->findViewableByHash($post->hash, $admin));
    }

    public function test_find_viewable_shows_a_soft_deleted_post_to_an_admin(): void {
        $post = Trashpost::factory()->deleted()->create();
        $admin = User::factory()->admin()->create();

        $found = $this->service()->findViewableByHash($post->hash, $admin);

        $this->assertNotNull($found);
        $this->assertSame($post->id, $found->id);
    }

    public function test_find_viewable_hides_a_soft_deleted_post_from_its_owner(): void {
        $owner = User::factory()->create();
        $post = Trashpost::factory()->deleted()->create(['user_id' => $owner->id]);

        $this->assertNull($this->service()->findViewableByHash($post->hash, $owner));
    }

    public function test_find_viewable_returns_null_for_an_unknown_hash(): void {
        $this->assertNull($this->service()->findViewableByHash('__nomatch__', User::factory()->admin()->create()));
    }

    public function test_create_post_stores_an_activated_youtube_post(): void {
        // Trusted uploader: since 011 activation is conditional on the uploader's
        // rating, so the activated path needs an account at the threshold.
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = $this->service()->createPost($user, 'My meme', null, 'dQw4w9WgXcQ');

        $this->assertSame('youtube', $post->type);
        $this->assertSame('dQw4w9WgXcQ', $post->youtube);
        $this->assertSame($user->id, $post->user_id);
        $this->assertSame($user->name, $post->username);
        $this->assertNotNull($post->activated_at);
        $this->assertDatabaseHas('trashposts', ['hash' => $post->hash]);
    }

    public function test_create_post_persists_the_shorts_flag_when_told_the_link_was_a_short(): void {
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = $this->service()->createPost($user, 'My short', null, 'dQw4w9WgXcQ', isShort: true);

        $this->assertTrue($post->youtube_is_short);
        $this->assertDatabaseHas('trashposts', ['hash' => $post->hash, 'youtube_is_short' => true]);
    }

    public function test_create_post_defaults_the_shorts_flag_to_false(): void {
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = $this->service()->createPost($user, 'My meme', null, 'dQw4w9WgXcQ');

        $this->assertFalse($post->youtube_is_short);
    }

    public function test_create_post_retries_when_the_minted_hash_collides(): void {
        Trashpost::factory()->create(['hash' => 'taken12345']);
        $user = User::factory()->create();
        $service = $this->serviceMinting(new TrashpostImageProcessor(), 'taken12345', 'fresh12345');

        $post = $service->createPost($user, null, null, 'dQw4w9WgXcQ');

        $this->assertSame('fresh12345', $post->hash);
    }

    public function test_create_post_gives_up_after_three_hash_collisions(): void {
        Trashpost::factory()->create(['hash' => 'taken12345']);
        $user = User::factory()->create();
        $service = $this->serviceMinting(
            new TrashpostImageProcessor(),
            'taken12345',
            'taken12345',
            'taken12345',
        );

        $this->expectException(UniqueConstraintViolationException::class);
        $service->createPost($user, null, null, 'dQw4w9WgXcQ');
    }

    public function test_create_post_removes_the_row_and_files_when_image_processing_fails(): void {
        $user = User::factory()->create();
        $image = UploadedFile::fake()->image('m.jpg', 100, 100);
        $processor = Mockery::mock(TrashpostImageProcessor::class);
        $processor->shouldReceive('process')->once()->andThrow(new RuntimeException('disk full'));
        // Cleanup must remove whatever process() managed to write before failing.
        $processor->shouldReceive('discard')->once();

        try {
            (new TrashpostService($processor))->createPost($user, null, $image, null);
            $this->fail('Expected the processing failure to be rethrown.');
        }
        catch (RuntimeException $e) {
            $this->assertSame('disk full', $e->getMessage());
        }

        // The reserved row must not linger (not even soft-deleted).
        $this->assertDatabaseCount('trashposts', 0);
    }

    public function test_creating_a_youtube_post_fetches_its_thumbnail_up_front(): void {
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        // A trusted uploader keeps the post activated. Media stays on the public disk in
        // every state now, so the still is public whether the post is activated or pending.
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = (new TrashpostService())->createPost($user, 'A video', null, 'dQw4w9WgXcQ');

        // Upload time is when the one-time download happens — the admin index must
        // never stack remote fetches inside a GET (review 2026-07-10).
        $this->assertNotNull($post->youtube_thumbnail);
        Storage::disk('public')->assertExists($post->youtube_thumbnail);
    }

    public function test_a_failed_thumbnail_fetch_does_not_fail_the_upload(): void {
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('', 404)]);
        $user = User::factory()->create();

        $post = (new TrashpostService())->createPost($user, 'A video', null, 'dQw4w9WgXcQ');

        $this->assertNull($post->youtube_thumbnail);
        $this->assertTrue($post->exists);
    }

    /**
     * A member at the given rating. Assigned, not mass-assigned — `rating` is
     * deliberately absent from User::$fillable (FR-003).
     */
    private function memberAt(int $rating): User {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return $user;
    }

    public function test_a_below_threshold_members_youtube_upload_is_created_pending(): void {
        // FR-018: activation is set in reserve() for the YouTube branch, so this is the
        // half of the change that branch exercises.
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $post = (new TrashpostService())->createPost($member, 'Waiting', null, 'dQw4w9WgXcQ');

        $this->assertNull($post->activated_at);
        $this->assertSame(RatingService::TRUST_THRESHOLD - 1, $member->fresh()->rating);
    }

    public function test_a_below_threshold_members_image_upload_is_created_pending(): void {
        // The image branch activates in attachImage(), a separate assignment from
        // reserve() — both must honour the same decision.
        Storage::fake('public');
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $post = (new TrashpostService())->createPost(
            $member,
            'Waiting',
            UploadedFile::fake()->image('m.jpg', 100, 100),
            null,
        );

        $this->assertNull($post->activated_at);
        $this->assertSame(RatingService::TRUST_THRESHOLD - 1, $member->fresh()->rating);
    }

    public function test_a_trusted_members_youtube_upload_is_activated_and_credited(): void {
        // FR-019: an auto-activation earns its +1 on the same terms as a moderator's.
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = (new TrashpostService())->createPost($member, 'Live now', null, 'dQw4w9WgXcQ');

        $this->assertNotNull($post->activated_at);
        $this->assertSame(RatingService::TRUST_THRESHOLD + 1, $member->fresh()->rating);
    }

    public function test_a_trusted_members_image_upload_is_activated_and_credited(): void {
        Storage::fake('public');
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $post = (new TrashpostService())->createPost(
            $member,
            'Live now',
            UploadedFile::fake()->image('m.jpg', 100, 100),
            null,
        );

        $this->assertNotNull($post->activated_at);
        $this->assertSame(RatingService::TRUST_THRESHOLD + 1, $member->fresh()->rating);
    }

    /**
     * FR-040: the auto-activation path publishes a meme without a moderator ever
     * touching it, so it has to drop the permalink's cached metadata for exactly the
     * same reason ModerationService::activate does. The address can already be warm:
     * anything that requested it before the upload landed cached the generic
     * not-a-public-meme block under it.
     */
    public function test_an_auto_activated_upload_forgets_its_permalinks_metadata(): void {
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD);
        $hash = 'Abcdefghij';
        $key = 'seo:meta:v2:' . sha1("/posts/{$hash}");
        (new PageMetaService())->forPath("/posts/{$hash}");
        $this->assertNotNull(Cache::get($key), 'the metadata cache was not warmed');

        $post = $this->serviceMinting(new TrashpostImageProcessor(), $hash)
            ->createPost($member, 'Live now', null, 'dQw4w9WgXcQ');

        $this->assertSame($hash, $post->hash);
        $this->assertNull(Cache::get($key));
    }

    public function test_a_failed_credit_leaves_no_activated_but_uncredited_post(): void {
        // FR-013: the activation and its credit commit together. Without a transaction
        // around the pair, a credit that blows up would leave a live, permanently
        // uncredited post — a rating the account can never earn back.
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        $member = $this->memberAt(RatingService::TRUST_THRESHOLD);
        $rating = Mockery::mock(RatingService::class)->makePartial();
        $rating->shouldReceive('shouldAutoActivate')->andReturn(true);
        $rating->shouldReceive('credit')->once()->andThrow(new RuntimeException('rating write failed'));

        try {
            (new TrashpostService(rating: $rating))->createPost($member, 'Doomed', null, 'dQw4w9WgXcQ');
            $this->fail('Expected the failed credit to be rethrown.');
        }
        catch (RuntimeException $e) {
            $this->assertSame('rating write failed', $e->getMessage());
        }

        $this->assertSame(0, Trashpost::withTrashed()->whereNotNull('activated_at')->count());
    }

    public function test_feed_eager_loads_the_owner_to_avoid_n_plus_one(): void {
        $user = User::factory()->create();
        Trashpost::factory()->visible()->create(['user_id' => $user->id]);

        $posts = (new TrashpostService())->feed([]);

        // The owner is hydrated up front, so the resource reads user->name without a
        // per-row lazy query across a page.
        $this->assertTrue($posts->first()->relationLoaded('user'));
    }
}
