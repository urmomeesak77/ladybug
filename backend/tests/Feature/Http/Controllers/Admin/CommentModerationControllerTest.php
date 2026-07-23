<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers\Admin;

use App\Models\Comment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Admin comment moderation (hide/unhide/delete), keyed by the comment's public hash and gated
 * by the existing admin group (auth:sanctum + role:admin): guests get 401, members 403 without
 * any per-action role code. Delete cases (US4) are added alongside.
 */
final class CommentModerationControllerTest extends TestCase {
    use RefreshDatabase;

    private function admin(): User {
        return User::factory()->admin()->create();
    }

    public function test_hide_refuses_a_guest_with_401(): void {
        $comment = Comment::factory()->create();

        $this->postJson("/api/admin/comments/{$comment->hash}/hide")->assertUnauthorized();
    }

    public function test_hide_refuses_a_member_with_403(): void {
        $comment = Comment::factory()->create();

        $this->actingAs(User::factory()->create())
            ->postJson("/api/admin/comments/{$comment->hash}/hide")
            ->assertForbidden();
    }

    public function test_hide_returns_the_updated_row_flagged_hidden(): void {
        $comment = Comment::factory()->create();

        $response = $this->actingAs($this->admin())->postJson("/api/admin/comments/{$comment->hash}/hide");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $comment->hash);
        $response->assertJsonPath('data.hidden', true);
        $this->assertNotNull($comment->fresh()->hidden_at);
    }

    public function test_hide_is_idempotent_across_repeated_calls(): void {
        $comment = Comment::factory()->create();
        $admin = $this->admin();

        $this->actingAs($admin)->postJson("/api/admin/comments/{$comment->hash}/hide")->assertOk();
        $this->actingAs($admin)->postJson("/api/admin/comments/{$comment->hash}/hide")
            ->assertOk()
            ->assertJsonPath('data.hidden', true);
    }

    public function test_hide_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->postJson('/api/admin/comments/Nonexist99/hide')
            ->assertNotFound();
    }

    public function test_unhide_refuses_a_member_with_403(): void {
        $comment = Comment::factory()->hidden()->create();

        $this->actingAs(User::factory()->create())
            ->postJson("/api/admin/comments/{$comment->hash}/unhide")
            ->assertForbidden();
    }

    public function test_unhide_returns_the_updated_row_visible_again(): void {
        $comment = Comment::factory()->hidden()->create();

        $response = $this->actingAs($this->admin())->postJson("/api/admin/comments/{$comment->hash}/unhide");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $comment->hash);
        $response->assertJsonPath('data.hidden', false);
        $this->assertNull($comment->fresh()->hidden_at);
    }

    public function test_unhide_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->postJson('/api/admin/comments/Nonexist99/unhide')
            ->assertNotFound();
    }
}
