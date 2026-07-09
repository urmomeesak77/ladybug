<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers\Admin;

use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The moderation index endpoint as an admin (US1). Returns the documented paginator
 * envelope over every meme, newest-first, 100/page; an out-of-range page is an empty
 * page, not an error. Access-control cases (guest/member/superuser) land in US2.
 */
final class ModerationControllerTest extends TestCase {
    use RefreshDatabase;

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
            'data' => [['hash', 'thumbnail', 'type', 'username', 'created_at', 'activated', 'deleted', 'url']],
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
}
