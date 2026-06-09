<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Trashpost;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class TrashpostTest extends TestCase {
    use RefreshDatabase;

    public function test_uses_the_trashposts_table(): void {
        $this->assertSame('trashposts', (new Trashpost())->getTable());
    }

    public function test_mass_assignable_attributes(): void {
        $fillable = (new Trashpost())->getFillable();

        $this->assertSame(
            ['hash', 'title', 'type', 'file', 'youtube', 'user_id', 'comment', 'metadata'],
            $fillable,
        );
    }

    public function test_casts_timestamps_to_datetime(): void {
        $casts = (new Trashpost())->getCasts();

        foreach (['created_at', 'updated_at', 'activated_at', 'deleted_at'] as $column) {
            $this->assertSame('datetime', $casts[$column]);
        }
    }

    public function test_soft_delete_hides_the_row_and_sets_deleted_at(): void {
        $post = Trashpost::create(['hash' => 'softdelet1']);

        $post->delete();

        $this->assertNotNull($post->fresh()->deleted_at ?? $post->deleted_at);
        $this->assertNull(Trashpost::find($post->id));
        $this->assertNotNull(Trashpost::withTrashed()->find($post->id));
    }

    public function test_belongs_to_an_owning_user(): void {
        $user = User::factory()->create();
        $post = Trashpost::create(['hash' => 'owned00001', 'user_id' => $user->id]);

        $this->assertTrue($post->user->is($user));
    }
}
