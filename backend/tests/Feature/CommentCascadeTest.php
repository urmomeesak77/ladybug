<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\Comment;
use App\Models\Trashpost;
use App\Services\ModerationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The parent-purge cascade (FR-020, data-model D4): a hard delete of a trashpost removes its
 * comments via the FK, while a soft delete or a hide leaves them intact — the cascade fires
 * only on a real row delete, never on a reversible state change.
 */
final class CommentCascadeTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // ModerationService::purge sweeps media off both disks; fake them so the test never
        // touches the real bind-mounted media tree.
        Storage::fake('public');
        Storage::fake('local');
    }

    public function test_purging_a_post_cascade_deletes_its_comments(): void {
        $post = Trashpost::factory()->create();
        $comments = Comment::factory()->for($post, 'trashpost')->count(3)->create();

        (new ModerationService())->purge($post->hash);

        foreach ($comments as $comment) {
            $this->assertDatabaseMissing('comments', ['id' => $comment->id]);
        }
    }

    public function test_soft_deleting_a_post_keeps_its_comments(): void {
        $post = Trashpost::factory()->create();
        $comment = Comment::factory()->for($post, 'trashpost')->create();

        (new ModerationService())->delete($post->hash);

        // A soft delete is reversible, so the comments must survive for a later restore (D4).
        $this->assertDatabaseHas('comments', ['id' => $comment->id]);
    }

    public function test_hiding_a_post_keeps_its_comments(): void {
        $post = Trashpost::factory()->create(['activated_at' => now()]);
        $comment = Comment::factory()->for($post, 'trashpost')->create();

        (new ModerationService())->deactivate($post->hash);

        $this->assertDatabaseHas('comments', ['id' => $comment->id]);
    }
}
