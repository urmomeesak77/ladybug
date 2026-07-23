<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use App\Services\CommentService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The comment query/transition layer. `list` is viewer-aware: everyone sees the public
 * (non-hidden) rows newest-first in batches of 10 with keyset paging over the comment
 * hash; an admin additionally sees hidden rows flagged, but `meta.total` is always the
 * public count regardless of viewer (data-model D6/D7).
 */
final class CommentServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): CommentService {
        return new CommentService();
    }

    public function test_list_returns_comments_newest_first(): void {
        $post = Trashpost::factory()->create();
        $older = Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()->subMinutes(2)]);
        $newer = Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()]);

        $result = $this->service()->list($post, null, null);

        $this->assertSame([$newer->hash, $older->hash], $result['comments']->pluck('hash')->all());
    }

    public function test_list_orders_same_instant_rows_by_id_desc(): void {
        $post = Trashpost::factory()->create();
        $at = now();
        $first = Comment::factory()->for($post, 'trashpost')->create(['created_at' => $at]);
        $second = Comment::factory()->for($post, 'trashpost')->create(['created_at' => $at]);

        $result = $this->service()->list($post, null, null);

        // Same created_at → the larger id (inserted later) comes first (newest-first).
        $this->assertSame([$second->hash, $first->hash], $result['comments']->pluck('hash')->all());
    }

    public function test_list_returns_a_batch_of_ten(): void {
        $post = Trashpost::factory()->create();
        Comment::factory()->for($post, 'trashpost')->count(12)->create();

        $result = $this->service()->list($post, null, null);

        $this->assertCount(10, $result['comments']);
        $this->assertTrue($result['has_more']);
        $this->assertNotNull($result['next_cursor']);
    }

    public function test_list_last_batch_reports_no_more_and_a_null_cursor(): void {
        $post = Trashpost::factory()->create();
        Comment::factory()->for($post, 'trashpost')->count(3)->create();

        $result = $this->service()->list($post, null, null);

        $this->assertCount(3, $result['comments']);
        $this->assertFalse($result['has_more']);
        $this->assertNull($result['next_cursor']);
    }

    public function test_list_before_cursor_returns_the_next_older_batch_without_overlap(): void {
        $post = Trashpost::factory()->create();
        // 15 comments a minute apart so ordering is deterministic.
        for ($i = 0; $i < 15; $i++) {
            Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()->subMinutes($i)]);
        }

        $first = $this->service()->list($post, null, null);
        $second = $this->service()->list($post, $first['next_cursor'], null);

        $this->assertCount(5, $second['comments']);
        $seen = $first['comments']->pluck('hash')->merge($second['comments']->pluck('hash'));
        $this->assertSame($seen->count(), $seen->unique()->count(), 'pages must not overlap');
    }

    public function test_list_hides_hidden_rows_from_a_guest(): void {
        $post = Trashpost::factory()->create();
        $visible = Comment::factory()->for($post, 'trashpost')->create();
        Comment::factory()->for($post, 'trashpost')->hidden()->create();

        $result = $this->service()->list($post, null, null);

        $this->assertSame([$visible->hash], $result['comments']->pluck('hash')->all());
    }

    public function test_list_hides_hidden_rows_from_a_member(): void {
        $post = Trashpost::factory()->create();
        $visible = Comment::factory()->for($post, 'trashpost')->create();
        Comment::factory()->for($post, 'trashpost')->hidden()->create();

        $result = $this->service()->list($post, null, User::factory()->create());

        $this->assertSame([$visible->hash], $result['comments']->pluck('hash')->all());
    }

    public function test_list_includes_hidden_rows_flagged_for_an_admin(): void {
        $post = Trashpost::factory()->create();
        Comment::factory()->for($post, 'trashpost')->create();
        $hidden = Comment::factory()->for($post, 'trashpost')->hidden()->create();

        $result = $this->service()->list($post, null, User::factory()->admin()->create());

        $hashes = $result['comments']->pluck('hash')->all();
        $this->assertContains($hidden->hash, $hashes);
        $this->assertTrue($result['comments']->firstWhere('hash', $hidden->hash)->isHidden());
    }

    public function test_list_total_is_the_public_count_regardless_of_viewer(): void {
        $post = Trashpost::factory()->create();
        Comment::factory()->for($post, 'trashpost')->count(2)->create();
        Comment::factory()->for($post, 'trashpost')->hidden()->count(3)->create();

        // The public count excludes hidden rows for a guest AND for an admin who sees them.
        $this->assertSame(2, $this->service()->list($post, null, null)['total']);
        $this->assertSame(2, $this->service()->list($post, null, User::factory()->admin()->create())['total']);
    }

    public function test_list_only_returns_the_given_posts_comments(): void {
        $post = Trashpost::factory()->create();
        $other = Trashpost::factory()->create();
        $mine = Comment::factory()->for($post, 'trashpost')->create();
        Comment::factory()->for($other, 'trashpost')->create();

        $result = $this->service()->list($post, null, null);

        $this->assertSame([$mine->hash], $result['comments']->pluck('hash')->all());
        $this->assertSame(1, $result['total']);
    }

    public function test_create_persists_a_comment_attributed_to_the_author(): void {
        $post = Trashpost::factory()->create();
        $author = User::factory()->create(['name' => 'Alice']);

        $comment = $this->service()->create($post, $author, 'Nice meme!');

        $this->assertSame($post->id, $comment->trashpost_id);
        $this->assertSame($author->id, $comment->user_id);
        $this->assertSame('Nice meme!', $comment->body);
        $this->assertDatabaseHas('comments', ['id' => $comment->id, 'body' => 'Nice meme!']);
    }

    public function test_create_snapshots_the_authors_name(): void {
        $post = Trashpost::factory()->create();
        $author = User::factory()->create(['name' => 'Alice']);

        $comment = $this->service()->create($post, $author, 'hi');

        $this->assertSame('Alice', $comment->username);
    }

    public function test_create_mints_a_ten_char_hash(): void {
        $post = Trashpost::factory()->create();
        $author = User::factory()->create();

        $comment = $this->service()->create($post, $author, 'hi');

        $this->assertSame(10, strlen((string) $comment->hash));
    }

    public function test_create_is_immediately_public(): void {
        $post = Trashpost::factory()->create();
        $author = User::factory()->create();

        $comment = $this->service()->create($post, $author, 'hi');

        $this->assertNull($comment->hidden_at);
        $this->assertFalse($comment->isHidden());
    }

    public function test_hide_marks_a_visible_comment_hidden(): void {
        $comment = Comment::factory()->create();

        $updated = $this->service()->hide($comment);

        $this->assertNotNull($updated->hidden_at);
        $this->assertTrue($updated->isHidden());
        $this->assertNotNull($comment->fresh()->hidden_at);
    }

    public function test_hide_is_idempotent_and_keeps_the_original_timestamp(): void {
        $comment = Comment::factory()->hidden()->create(['hidden_at' => now()->subDay()]);
        $original = $comment->hidden_at;

        $updated = $this->service()->hide($comment);

        // Set-to-target, not toggle: an already-hidden comment keeps its original hidden_at.
        $this->assertTrue($original->equalTo($updated->hidden_at));
    }

    public function test_unhide_restores_a_hidden_comment(): void {
        $comment = Comment::factory()->hidden()->create();

        $updated = $this->service()->unhide($comment);

        $this->assertNull($updated->hidden_at);
        $this->assertFalse($updated->isHidden());
        $this->assertNull($comment->fresh()->hidden_at);
    }

    public function test_unhide_is_idempotent_on_an_already_visible_comment(): void {
        $comment = Comment::factory()->create();

        $updated = $this->service()->unhide($comment);

        $this->assertNull($updated->hidden_at);
    }

    public function test_delete_hard_removes_the_row(): void {
        $comment = Comment::factory()->create();

        $this->service()->delete($comment);

        // No SoftDeletes tombstone — the row is gone for good (D3).
        $this->assertDatabaseMissing('comments', ['id' => $comment->id]);
    }

    public function test_delete_removes_a_hidden_comment_too(): void {
        // Delete supersedes the hidden state (edge case "Hide then delete").
        $comment = Comment::factory()->hidden()->create();

        $this->service()->delete($comment);

        $this->assertDatabaseMissing('comments', ['id' => $comment->id]);
    }

    public function test_list_ignores_an_unknown_before_cursor(): void {
        $post = Trashpost::factory()->create();
        Comment::factory()->for($post, 'trashpost')->count(2)->create();

        // A cursor that resolves to no comment is ignored — the newest batch is returned.
        $result = $this->service()->list($post, 'Nonexist99', null);

        $this->assertCount(2, $result['comments']);
    }

    public function test_hide_on_a_vanished_comment_throws(): void {
        // The row is loaded FOR UPDATE inside the transaction; a missing row aborts the
        // transition (the transaction rolls back and the error propagates as a 404).
        $comment = Comment::factory()->create();
        Comment::whereKey($comment->id)->delete();

        $this->expectException(ModelNotFoundException::class);
        $this->service()->hide($comment);
    }

    public function test_delete_on_a_vanished_comment_throws(): void {
        $comment = Comment::factory()->create();
        Comment::whereKey($comment->id)->delete();

        $this->expectException(ModelNotFoundException::class);
        $this->service()->delete($comment);
    }

    public function test_create_rethrows_after_exhausting_hash_collision_retries(): void {
        // Force every minted hash to collide with an existing row: after MAX_HASH_ATTEMPTS the
        // unique-constraint violation propagates rather than looping forever (matches reserve()).
        $post = Trashpost::factory()->create();
        $author = User::factory()->create();
        Comment::factory()->for($post, 'trashpost')->create(['hash' => 'FixedHash1']);

        $service = new class () extends CommentService {
            protected function mintHash(): string {
                return 'FixedHash1';
            }
        };

        $this->expectException(UniqueConstraintViolationException::class);
        $service->create($post, $author, 'boom');
    }
}
