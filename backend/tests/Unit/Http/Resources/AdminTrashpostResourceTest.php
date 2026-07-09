<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Resources;

use App\Http\Resources\AdminTrashpostResource;
use App\Models\Trashpost;
use App\Models\User;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The compact moderation row projection (data-model.md): hash, thumbnail, type, username,
 * created_at, activated_at, deleted_at, url — and nothing internal (id/user_id/file, Principle V).
 * The three timestamps are raw MySQL datetimes (Y-m-d H:i:s) or null.
 * The user column resolves to the account name when user_id resolves, else the stored
 * uploader name (FR-012); the thumbnail resolves the 100-size image variant or the YouTube
 * still, null when neither exists.
 */
final class AdminTrashpostResourceTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(Trashpost $post): array {
        return (new AdminTrashpostResource($post))->toArray(Request::create('/'));
    }

    public function test_exposes_the_documented_row_shape_and_url(): void {
        $post = Trashpost::factory()->create(['activated_at' => now(), 'deleted_at' => null]);

        $row = $this->toArray($post);

        $this->assertSame(
            ['hash', 'thumbnail', 'type', 'username', 'created_at', 'activated_at', 'deleted_at', 'url'],
            array_keys($row),
        );
        $this->assertSame($post->hash, $row['hash']);
        $this->assertSame("/posts/{$post->hash}", $row['url']);
    }

    public function test_omits_internal_fields(): void {
        $row = $this->toArray(Trashpost::factory()->create());

        foreach (['id', 'user_id', 'file'] as $internal) {
            $this->assertArrayNotHasKey($internal, $row);
        }
    }

    public function test_username_is_the_account_name_when_user_id_resolves(): void {
        $user = User::factory()->create(['name' => 'Ada']);
        $post = Trashpost::factory()->create(['user_id' => $user->id, 'username' => 'stale-name']);
        $post->load('user');

        $this->assertSame('Ada', $this->toArray($post)['username']);
    }

    public function test_username_falls_back_to_the_stored_name_when_unowned(): void {
        $post = Trashpost::factory()->create(['user_id' => null, 'username' => 'anon-uploader']);

        $this->assertSame('anon-uploader', $this->toArray($post)['username']);
    }

    public function test_activated_and_deleted_are_raw_mysql_datetimes_or_null(): void {
        $activatedAt = now()->setTime(8, 1, 10);
        $deletedAt = now()->setTime(9, 30, 0);
        $activeDeleted = Trashpost::factory()->create(['activated_at' => $activatedAt, 'deleted_at' => $deletedAt]);
        $inactiveLive = Trashpost::factory()->create(['activated_at' => null, 'deleted_at' => null]);

        $active = $this->toArray($activeDeleted);
        $this->assertSame($activatedAt->format('Y-m-d H:i:s'), $active['activated_at']);
        $this->assertSame($deletedAt->format('Y-m-d H:i:s'), $active['deleted_at']);

        $live = $this->toArray($inactiveLive);
        $this->assertNull($live['activated_at']);
        $this->assertNull($live['deleted_at']);
    }

    public function test_created_at_is_a_raw_mysql_datetime(): void {
        $createdAt = now()->setTime(12, 34, 56);
        $post = Trashpost::factory()->create(['created_at' => $createdAt]);

        $this->assertSame($createdAt->format('Y-m-d H:i:s'), $this->toArray($post)['created_at']);
    }

    public function test_image_thumbnail_is_the_100_variant_url_when_present(): void {
        $post = Trashpost::factory()->create(['type' => 'image', 'file' => 'abc1234567.jpg']);
        $rel = MediaPath::imageRelativePath('100', 'abc1234567', 'jpg');
        Storage::disk('public')->put($rel, 'x');

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame($disk->url($rel), $this->toArray($post)['thumbnail']);
    }

    public function test_image_thumbnail_is_null_when_the_100_variant_is_absent(): void {
        $post = Trashpost::factory()->create(['type' => 'image', 'file' => 'abc1234567.jpg']);

        $this->assertNull($this->toArray($post)['thumbnail']);
    }

    public function test_thumbnail_is_null_for_a_non_media_post(): void {
        $post = Trashpost::factory()->create(['type' => 'image', 'file' => null]);

        $this->assertNull($this->toArray($post)['thumbnail']);
    }

    public function test_youtube_thumbnail_is_resolved_through_the_thumbnail_service(): void {
        Http::fake(['img.youtube.com/*' => Http::response('IMG', 200)]);
        $post = Trashpost::factory()->linkOnly()->create(['youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => null]);
        $rel = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');
        $this->assertSame($disk->url($rel), $this->toArray($post)['thumbnail']);
        $disk->assertExists($rel);
    }
}
