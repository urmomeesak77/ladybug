<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /api/posts/{hash}/comments — the public, viewer-aware read side. Newest-first batches
 * of 10 with keyset paging, the public count in meta, and the same viewer-aware post
 * resolution as GET /api/posts/{hash} (a non-public post is 404 for the public).
 */
final class CommentControllerTest extends TestCase {
    use RefreshDatabase;

    public function test_index_returns_the_documented_envelope_newest_first(): void {
        $post = Trashpost::factory()->visible()->create();
        $older = Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()->subMinute()]);
        $newer = Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()]);

        $response = $this->getJson("/api/posts/{$post->hash}/comments");

        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [['hash', 'body', 'username', 'hidden', 'created_at']],
            'meta' => ['total', 'next_cursor', 'has_more'],
        ]);
        $response->assertJsonPath('data.0.hash', $newer->hash);
        $response->assertJsonPath('data.1.hash', $older->hash);
        $response->assertJsonPath('meta.total', 2);
        $response->assertJsonPath('meta.has_more', false);
        $response->assertJsonPath('meta.next_cursor', null);
    }

    public function test_index_does_not_leak_internal_fields(): void {
        $post = Trashpost::factory()->visible()->create();
        Comment::factory()->for($post, 'trashpost')->create();

        $item = $this->getJson("/api/posts/{$post->hash}/comments")->json('data.0');

        foreach (['id', 'trashpost_id', 'user_id', 'hidden_at', 'updated_at'] as $internal) {
            $this->assertArrayNotHasKey($internal, $item);
        }
    }

    public function test_index_on_a_post_with_no_comments_is_an_explicit_empty_state(): void {
        $post = Trashpost::factory()->visible()->create();

        $response = $this->getJson("/api/posts/{$post->hash}/comments");

        $response->assertOk();
        $response->assertJsonCount(0, 'data');
        $response->assertJsonPath('meta.total', 0);
        $response->assertJsonPath('meta.has_more', false);
        $response->assertJsonPath('meta.next_cursor', null);
    }

    public function test_index_caps_a_batch_at_ten_and_pages_with_before(): void {
        $post = Trashpost::factory()->visible()->create();
        for ($i = 0; $i < 12; $i++) {
            Comment::factory()->for($post, 'trashpost')->create(['created_at' => now()->subMinutes($i)]);
        }

        $page1 = $this->getJson("/api/posts/{$post->hash}/comments");
        $page1->assertJsonCount(10, 'data');
        $page1->assertJsonPath('meta.has_more', true);
        $cursor = $page1->json('meta.next_cursor');
        $this->assertNotNull($cursor);

        $page2 = $this->getJson("/api/posts/{$post->hash}/comments?before={$cursor}");
        $page2->assertJsonCount(2, 'data');
        $page2->assertJsonPath('meta.has_more', false);

        $seen = array_merge($page1->json('data.*.hash'), $page2->json('data.*.hash'));
        $this->assertSame($seen, array_unique($seen), 'pages must not overlap');
    }

    public function test_index_on_an_unknown_post_hash_is_404(): void {
        $this->getJson('/api/posts/__nomatch__/comments')->assertNotFound();
    }

    public function test_index_on_a_hidden_post_is_404_for_the_public(): void {
        $post = Trashpost::factory()->hidden()->create();

        $this->getJson("/api/posts/{$post->hash}/comments")->assertNotFound();
    }

    public function test_index_excludes_hidden_comments_from_a_guest(): void {
        $post = Trashpost::factory()->visible()->create();
        $visible = Comment::factory()->for($post, 'trashpost')->create();
        $hidden = Comment::factory()->for($post, 'trashpost')->hidden()->create();

        $hashes = $this->getJson("/api/posts/{$post->hash}/comments")->json('data.*.hash');

        $this->assertContains($visible->hash, $hashes);
        $this->assertNotContains($hidden->hash, $hashes);
    }

    public function test_index_includes_hidden_comments_flagged_for_an_admin(): void {
        $post = Trashpost::factory()->visible()->create();
        Comment::factory()->for($post, 'trashpost')->create();
        $hidden = Comment::factory()->for($post, 'trashpost')->hidden()->create();

        $response = $this->actingAs(User::factory()->admin()->create())
            ->getJson("/api/posts/{$post->hash}/comments");

        $response->assertOk();
        $hashes = $response->json('data.*.hash');
        $this->assertContains($hidden->hash, $hashes);
        // The public count still excludes the hidden row even for the admin viewer (D7).
        $response->assertJsonPath('meta.total', 1);
    }

    public function test_index_author_name_reflects_the_linked_accounts_current_name(): void {
        $post = Trashpost::factory()->visible()->create();
        $user = User::factory()->create(['name' => 'Current Name']);
        Comment::factory()->for($post, 'trashpost')->create([
            'user_id' => $user->id,
            'username' => 'Stale Snapshot',
        ]);

        $this->getJson("/api/posts/{$post->hash}/comments")->assertJsonPath('data.0.username', 'Current Name');
    }

    public function test_store_rejects_a_guest_with_401(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->postJson("/api/posts/{$post->hash}/comments", ['body' => 'hi'])->assertUnauthorized();
        $this->assertDatabaseCount('comments', 0);
    }

    public function test_store_rejects_an_unverified_user_with_403(): void {
        $post = Trashpost::factory()->visible()->create();
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)->postJson("/api/posts/{$post->hash}/comments", ['body' => 'hi'])->assertForbidden();
        $this->assertDatabaseCount('comments', 0);
    }

    public function test_store_creates_a_comment_for_a_verified_user(): void {
        $post = Trashpost::factory()->visible()->create();
        $user = User::factory()->create(['name' => 'Alice']);

        $response = $this->actingAs($user)->postJson("/api/posts/{$post->hash}/comments", ['body' => 'Nice meme!']);

        $response->assertCreated();
        $response->assertJsonPath('data.body', 'Nice meme!');
        $response->assertJsonPath('data.username', 'Alice');
        $response->assertJsonPath('data.hidden', false);
        $this->assertNotNull($response->json('data.hash'));
        $this->assertDatabaseHas('comments', ['trashpost_id' => $post->id, 'user_id' => $user->id, 'body' => 'Nice meme!']);
    }

    public function test_store_rejects_an_empty_body_with_422(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->actingAs(User::factory()->create())
            ->postJson("/api/posts/{$post->hash}/comments", ['body' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('body');
        $this->assertDatabaseCount('comments', 0);
    }

    public function test_store_rejects_a_whitespace_only_body_with_422(): void {
        // prepareForValidation trims, so an all-whitespace body reduces to '' and fails required.
        $post = Trashpost::factory()->visible()->create();

        $this->actingAs(User::factory()->create())
            ->postJson("/api/posts/{$post->hash}/comments", ['body' => "   \n\t  "])
            ->assertStatus(422)
            ->assertJsonValidationErrors('body');
        $this->assertDatabaseCount('comments', 0);
    }

    public function test_store_rejects_a_body_over_1000_chars_with_422(): void {
        $post = Trashpost::factory()->visible()->create();

        $this->actingAs(User::factory()->create())
            ->postJson("/api/posts/{$post->hash}/comments", ['body' => str_repeat('a', 1001)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('body');
    }

    public function test_store_on_an_unknown_post_hash_is_404(): void {
        $this->actingAs(User::factory()->create())
            ->postJson('/api/posts/__nomatch__/comments', ['body' => 'hi'])
            ->assertNotFound();
    }

    public function test_store_stores_a_markup_body_verbatim(): void {
        // Server stores the bytes as-is (no sanitisation); the client escapes on output (D10).
        $post = Trashpost::factory()->visible()->create();
        $body = '<script>alert(1)</script>';

        $response = $this->actingAs(User::factory()->create())
            ->postJson("/api/posts/{$post->hash}/comments", ['body' => $body]);

        $response->assertCreated();
        $this->assertDatabaseHas('comments', ['trashpost_id' => $post->id, 'body' => $body]);
    }

    public function test_store_is_rate_limited_after_too_many_comments(): void {
        $post = Trashpost::factory()->visible()->create();
        $user = User::factory()->create();
        for ($i = 0; $i < 10; $i++) {
            $this->actingAs($user)->postJson("/api/posts/{$post->hash}/comments", ['body' => "c{$i}"]);
        }

        $this->actingAs($user)
            ->postJson("/api/posts/{$post->hash}/comments", ['body' => 'over cap'])
            ->assertStatus(429);
    }
}
