<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers\Admin;

use App\Models\Trashpost;
use App\Models\User;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The moderation index endpoint as an admin (US1). Returns the documented paginator
 * envelope over every meme, newest-first, 100/page; an out-of-range page is an empty
 * page, not an error. Access-control cases (guest/member/superuser) land in US2.
 */
final class ModerationControllerTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Every moderation transition now syncs media between disks, so any test
        // hitting those endpoints does storage I/O — fake both disks up front so
        // no test can ever touch the real bind-mounted media tree.
        Storage::fake('public');
        Storage::fake('local');
    }

    private function admin(): User {
        return User::factory()->admin()->create();
    }

    public function test_index_refuses_a_guest_with_401(): void {
        // The boundary protects the DATA, not just the SPA page (Principle VI):
        // an unauthenticated JSON request is rejected before any row is emitted.
        $this->getJson('/api/admin/posts')->assertUnauthorized();
    }

    public function test_index_refuses_a_member_with_403(): void {
        $member = User::factory()->create();

        $this->actingAs($member)->getJson('/api/admin/posts')->assertForbidden();
    }

    public function test_index_admits_an_admin(): void {
        $this->actingAs($this->admin())->getJson('/api/admin/posts')->assertOk();
    }

    public function test_index_admits_a_superuser(): void {
        $superuser = User::factory()->superuser()->create();

        $this->actingAs($superuser)->getJson('/api/admin/posts')->assertOk();
    }

    public function test_index_returns_the_paginator_envelope_newest_first(): void {
        $older = Trashpost::factory()->create(['created_at' => now()->subDay()]);
        $newer = Trashpost::factory()->create(['created_at' => now()]);

        $response = $this->actingAs($this->admin())->getJson('/api/admin/posts');

        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [['hash', 'thumbnail', 'title', 'type', 'username', 'created_at', 'activated_at', 'deleted_at']],
            'links' => ['first', 'last', 'prev', 'next'],
            'meta' => ['current_page', 'last_page', 'per_page', 'total'],
        ]);
        $response->assertJsonPath('meta.per_page', 100);
        $response->assertJsonPath('data.0.hash', $newer->hash);
        $response->assertJsonPath('data.1.hash', $older->hash);
    }

    public function test_index_lists_every_state(): void {
        $hidden = Trashpost::factory()->hidden()->create();
        $deleted = Trashpost::factory()->deleted()->create();

        $hashes = $this->actingAs($this->admin())->getJson('/api/admin/posts')->json('data.*.hash');

        $this->assertContains($hidden->hash, $hashes);
        $this->assertContains($deleted->hash, $hashes);
    }

    public function test_index_page_beyond_the_last_is_an_empty_page_not_an_error(): void {
        Trashpost::factory()->count(3)->create();

        $response = $this->actingAs($this->admin())->getJson('/api/admin/posts?page=9');

        $response->assertOk();
        $response->assertJsonCount(0, 'data');
        $response->assertJsonPath('meta.total', 3);
    }

    public function test_index_over_an_empty_corpus_returns_zero_total(): void {
        $response = $this->actingAs($this->admin())->getJson('/api/admin/posts');

        $response->assertOk();
        $response->assertJsonCount(0, 'data');
        $response->assertJsonPath('meta.total', 0);
    }

    public function test_activate_returns_the_updated_row(): void {
        $post = Trashpost::factory()->hidden()->create();

        $response = $this->actingAs($this->admin())->postJson("/api/admin/posts/{$post->hash}/activate");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $post->hash);
        $this->assertNotNull($response->json('data.activated_at'));
    }

    public function test_deactivate_returns_the_updated_row(): void {
        $post = Trashpost::factory()->create(['activated_at' => now()]);

        $response = $this->actingAs($this->admin())->postJson("/api/admin/posts/{$post->hash}/deactivate");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $post->hash);
        $response->assertJsonPath('data.activated_at', null);
    }

    public function test_activate_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->postJson('/api/admin/posts/Nonexist99/activate')
            ->assertNotFound();
    }

    public function test_activate_stays_idempotent_across_repeated_calls(): void {
        $post = Trashpost::factory()->create(['activated_at' => now()]);
        $admin = $this->admin();

        $this->actingAs($admin)->postJson("/api/admin/posts/{$post->hash}/activate")->assertOk();
        $response = $this->actingAs($admin)->postJson("/api/admin/posts/{$post->hash}/activate")->assertOk();
        $this->assertNotNull($response->json('data.activated_at'));
    }

    public function test_destroy_soft_deletes_and_returns_the_updated_row(): void {
        $post = Trashpost::factory()->create();

        $response = $this->actingAs($this->admin())->deleteJson("/api/admin/posts/{$post->hash}");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $post->hash);
        $this->assertNotNull($response->json('data.deleted_at'));
    }

    public function test_restore_returns_the_updated_row(): void {
        $post = Trashpost::factory()->deleted()->create();

        $response = $this->actingAs($this->admin())->postJson("/api/admin/posts/{$post->hash}/restore");

        $response->assertOk();
        $response->assertJsonPath('data.hash', $post->hash);
        $response->assertJsonPath('data.deleted_at', null);
    }

    public function test_destroy_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->deleteJson('/api/admin/posts/Nonexist99')
            ->assertNotFound();
    }

    public function test_restore_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->postJson('/api/admin/posts/Nonexist99/restore')
            ->assertNotFound();
    }

    public function test_a_soft_deleted_meme_disappears_from_the_public_views(): void {
        // US4 acceptance #3: soft-deleted memes are retained but gone from public surfaces.
        $post = Trashpost::factory()->visible()->create();

        $this->actingAs($this->admin())->deleteJson("/api/admin/posts/{$post->hash}")->assertOk();

        $this->getJson('/api/posts')->assertOk()->assertJsonMissing(['hash' => $post->hash]);
        $this->getJson("/api/posts/{$post->hash}")->assertNotFound();
    }

    public function test_purge_refuses_a_guest_with_401(): void {
        $post = Trashpost::factory()->create();

        $this->deleteJson("/api/admin/posts/{$post->hash}/purge")->assertUnauthorized();
    }

    public function test_purge_refuses_a_member_with_403(): void {
        $member = User::factory()->create();
        $post = Trashpost::factory()->create();

        $this->actingAs($member)->deleteJson("/api/admin/posts/{$post->hash}/purge")->assertForbidden();
    }

    public function test_purge_returns_204_and_removes_the_row_and_files(): void {
        $post = Trashpost::factory()->create();
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $path = MediaPath::imageRelativePath('original', $code, $ext);
        Storage::disk('public')->put($path, 'stub');

        $this->actingAs($this->admin())
            ->deleteJson("/api/admin/posts/{$post->hash}/purge")
            ->assertNoContent();

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
        Storage::disk('public')->assertMissing($path);
    }

    public function test_purge_works_on_a_soft_deleted_meme(): void {
        $post = Trashpost::factory()->deleted()->create();

        $this->actingAs($this->admin())
            ->deleteJson("/api/admin/posts/{$post->hash}/purge")
            ->assertNoContent();

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->deleteJson('/api/admin/posts/Nonexist99/purge')
            ->assertNotFound();
    }
}
