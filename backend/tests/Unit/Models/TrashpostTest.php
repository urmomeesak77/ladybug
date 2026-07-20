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
            ['title', 'file', 'type', 'metadata', 'comment'],
            $fillable,
        );
    }

    public function test_casts_timestamps_to_datetime(): void {
        $casts = (new Trashpost())->getCasts();

        foreach (['created_at', 'updated_at', 'activated_at', 'deleted_at'] as $column) {
            $this->assertSame('datetime', $casts[$column]);
        }
    }

    public function test_rating_flags_default_to_false(): void {
        $post = new Trashpost();
        $post->hash = 'ratingflg1';
        $post->save();

        $fresh = $post->fresh();
        $this->assertFalse($fresh->rating_credited);
        $this->assertFalse($fresh->rating_penalized);
    }

    public function test_rating_flags_hydrate_as_booleans(): void {
        $casts = (new Trashpost())->getCasts();

        $this->assertSame('boolean', $casts['rating_credited']);
        $this->assertSame('boolean', $casts['rating_penalized']);
    }

    public function test_rating_flags_are_not_mass_assignable(): void {
        // The flags are the idempotency ledger RatingService writes; a request
        // body must never be able to replay or suppress an adjustment.
        $post = new Trashpost();
        $post->hash = 'notfilled1';
        $post->fill(['rating_credited' => true, 'rating_penalized' => true]);
        $post->save();

        // fill() drops both keys outright, so the row lands on its column
        // defaults rather than the values the caller asked for.
        $fresh = $post->fresh();
        $this->assertFalse($fresh->rating_credited);
        $this->assertFalse($fresh->rating_penalized);
    }

    public function test_soft_delete_hides_the_row_and_sets_deleted_at(): void {
        // hash is identity, not content — no longer mass assignable (see
        // $fillable), so it is set explicitly like in the sibling tests.
        $post = new Trashpost();
        $post->hash = 'softdelet1';
        $post->save();

        $post->delete();

        $this->assertNotNull($post->fresh()->deleted_at ?? $post->deleted_at);
        $this->assertNull(Trashpost::find($post->id));
        $this->assertNotNull(Trashpost::withTrashed()->find($post->id));
    }

    public function test_belongs_to_an_owning_user(): void {
        $user = User::factory()->create();
        // hash/user_id are identity/ownership, not content — no longer mass
        // assignable (see $fillable), so they are set explicitly here too.
        $post = new Trashpost();
        $post->hash = 'owned00001';
        $post->user_id = $user->id;
        $post->save();

        $this->assertTrue($post->user->is($user));
    }
}
