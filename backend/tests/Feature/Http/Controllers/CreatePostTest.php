<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CreatePostTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        $this->withHeader('Origin', 'http://localhost');
    }

    public function test_anonymous_upload_is_rejected(): void {
        $response = $this->postJson('/api/posts', ['youtube' => 'dQw4w9WgXcQ']);
        $response->assertStatus(401);
    }

    public function test_authenticated_image_upload_creates_a_visible_post(): void {
        $user = User::factory()->create();

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
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.type', 'youtube');
        $response->assertJsonPath('data.youtube', 'dQw4w9WgXcQ');
    }

    public function test_rejects_when_neither_image_nor_youtube_is_present(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', ['title' => 'x']);
        $response->assertStatus(422);
    }

    public function test_rejects_when_both_image_and_youtube_are_present(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'image' => UploadedFile::fake()->image('m.jpg', 10, 10),
            'youtube' => 'dQw4w9WgXcQ',
        ]);
        $response->assertStatus(422);
    }

    public function test_rejects_an_invalid_youtube_link(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', ['youtube' => 'https://example.com/x']);
        $response->assertStatus(422)->assertJsonValidationErrors('youtube');
    }

    public function test_upload_is_rate_limited_after_too_many_attempts(): void {
        $user = User::factory()->create();
        for ($i = 0; $i < 10; $i++) {
            $this->actingAs($user)->postJson('/api/posts', ['youtube' => 'dQw4w9WgXcQ']);
        }

        $response = $this->actingAs($user)->postJson('/api/posts', ['youtube' => 'dQw4w9WgXcQ']);

        // Uploads are heavier than reads (image processing, disk writes); a per-user
        // cap keeps one account from flooding the feed or the disk.
        $response->assertStatus(429);
    }

    public function test_rejects_a_non_image_file(): void {
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/posts', [
            'image' => UploadedFile::fake()->create('doc.pdf', 100, 'application/pdf'),
        ]);
        $response->assertStatus(422)->assertJsonValidationErrors('image');
    }
}
