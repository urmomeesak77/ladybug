<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\RatingService;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CreatePostTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        // Pending uploads park their media on the private disk (011/research D4), so
        // both sides of the move must be faked for the visibility assertions to mean
        // anything.
        Storage::fake('local');
        $this->withHeader('Origin', 'http://localhost');
        // TrashpostService::createPost now fetches the YouTube thumbnail up front
        // (review 2026-07-10); fake it so these tests never make a real network call.
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
    }

    public function test_anonymous_upload_is_rejected(): void {
        $response = $this->postJson('/api/posts', ['youtube' => 'dQw4w9WgXcQ']);
        $response->assertStatus(401);
    }

    /**
     * A member at the given rating. Assigned, not mass-assigned (FR-003).
     */
    private function memberAt(int $rating): User {
        $user = User::factory()->create();
        $user->rating = $rating;
        $user->save();

        return $user;
    }

    public function test_authenticated_image_upload_creates_a_visible_post(): void {
        // Trusted uploader: since 011 a fresh account's upload waits for a moderator,
        // so the "goes live immediately" path needs a rating at the threshold.
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD);

        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'My meme',
            'image' => UploadedFile::fake()->image('m.jpg', 1000, 500),
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.type', 'image');
        $response->assertJsonPath('data.title', 'My meme');

        $hash = $response->json('data.hash');
        $post = Trashpost::where('hash', $hash)->first();
        $this->assertNotNull($post);
        $this->assertNotNull($post->activated_at);
        $this->assertSame($user->id, $post->user_id);
    }

    public function test_authenticated_youtube_upload_stores_only_the_id(): void {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'My song',
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.type', 'youtube');
        $response->assertJsonPath('data.youtube', 'dQw4w9WgXcQ');
    }

    public function test_unverified_user_cannot_create_post(): void {
        $user = User::factory()->unverified()->create();

        // Valid YouTube payload on purpose: a 403 here is unambiguously the
        // verification gate, not validation.
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'Blocked post',
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);

        $response->assertStatus(403);
        $this->assertDatabaseCount('trashposts', 0);
    }

    public function test_rejects_when_neither_image_nor_youtube_is_present(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', ['title' => 'x']);
        $response->assertStatus(422);
    }

    public function test_rejects_when_title_is_missing(): void {
        // 014: a title is now required. A valid YouTube payload isolates the title rule.
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);
        $response->assertStatus(422)->assertJsonValidationErrors('title');
        $this->assertDatabaseCount('trashposts', 0);
    }

    public function test_rejects_a_whitespace_only_title(): void {
        // TrimStrings collapses a whitespace-only title to empty, which fails `required`.
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => '   ',
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);
        $response->assertStatus(422)->assertJsonValidationErrors('title');
        $this->assertDatabaseCount('trashposts', 0);
    }

    public function test_rejects_when_both_image_and_youtube_are_present(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'Both',
            'image' => UploadedFile::fake()->image('m.jpg', 10, 10),
            'youtube' => 'dQw4w9WgXcQ',
        ]);
        $response->assertStatus(422);
    }

    public function test_rejects_an_invalid_youtube_link(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'Bad link',
            'youtube' => 'https://example.com/x',
        ]);
        $response->assertStatus(422)->assertJsonValidationErrors('youtube');
    }

    public function test_upload_is_rate_limited_after_too_many_attempts(): void {
        $user = User::factory()->create();
        for ($i = 0; $i < 10; $i++) {
            $this->actingAs($user)->postJson('/api/posts', ['title' => 'Spam', 'youtube' => 'dQw4w9WgXcQ']);
        }

        $response = $this->actingAs($user)->postJson('/api/posts', ['title' => 'Spam', 'youtube' => 'dQw4w9WgXcQ']);

        // Uploads are heavier than reads (image processing, disk writes); a per-user
        // cap keeps one account from flooding the feed or the disk.
        $response->assertStatus(429);
    }

    public function test_rejects_a_non_image_file(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'A doc',
            'image' => UploadedFile::fake()->create('doc.pdf', 100, 'application/pdf'),
        ]);
        $response->assertStatus(422)->assertJsonValidationErrors('image');
    }

    public function test_a_below_threshold_upload_still_returns_201(): void {
        // Waiting for a moderator is not an error: the upload succeeded (FR-018).
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'Pending meme',
            'image' => UploadedFile::fake()->image('m.jpg', 200, 200),
        ]);

        $response->assertCreated();
        $post = Trashpost::where('hash', $response->json('data.hash'))->first();
        $this->assertNotNull($post);
        $this->assertNull($post->activated_at);
    }

    public function test_a_pending_uploads_image_variants_stay_on_the_public_disk(): void {
        // Media stays public in every state (design 2026-07-21) so a moderator can see the
        // pending image in the admin console; the public API still hides the row.
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $response = $this->actingAs($user)->postJson('/api/posts', [
            'title' => 'Pending image',
            'image' => UploadedFile::fake()->image('m.jpg', 1000, 500),
        ]);

        $post = Trashpost::where('hash', $response->json('data.hash'))->firstOrFail();
        $this->assertNotNull($post->file);
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        foreach (MediaPath::imageSizes() as $size) {
            $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->assertExists($path);
        }
    }

    public function test_a_pending_youtube_uploads_thumbnail_stays_on_the_public_disk(): void {
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $response = $this->actingAs($user)->postJson('/api/posts', ['title' => 'Pending clip', 'youtube' => 'dQw4w9WgXcQ']);

        $response->assertCreated();
        $post = Trashpost::where('hash', $response->json('data.hash'))->firstOrFail();
        $this->assertNotNull($post->youtube_thumbnail);
        Storage::disk('public')->assertExists($post->youtube_thumbnail);
    }

    public function test_a_pending_upload_is_absent_from_the_public_views(): void {
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $hash = $this->actingAs($user)
            ->postJson('/api/posts', ['title' => 'Pending public', 'youtube' => 'dQw4w9WgXcQ'])
            ->json('data.hash');

        // Assert the PUBLIC perspective: a pending upload is visible to its owner (who is
        // still authenticated above), so drop the guard to check it as an anonymous visitor.
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/posts/{$hash}")->assertNotFound();
        $this->getJson('/api/posts')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_an_admin_below_the_threshold_publishes_immediately_and_earns_the_credit(): void {
        // US3: a moderator skips the queue on role alone. A negative rating is the
        // sharpest case — the very account the rating gate would hold back longest.
        $admin = User::factory()->admin()->create();
        $admin->rating = -5;
        $admin->save();

        $hash = $this->actingAs($admin)
            ->postJson('/api/posts', ['title' => 'Admin post', 'youtube' => 'dQw4w9WgXcQ'])
            ->assertCreated()
            ->json('data.hash');

        $this->assertNotNull(Trashpost::where('hash', $hash)->first()->activated_at);
        $this->getJson("/api/posts/{$hash}")->assertOk();
        $this->assertSame(-4, $admin->fresh()->rating);
    }
}
