<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use App\Utils\Str;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Comment>
 */
class CommentFactory extends Factory {
    protected $model = Comment::class;

    /**
     * Define the model's default state: a visible comment on a fresh post, authored by a
     * fresh account whose name is snapshotted into `username` (the orphan-fallback display,
     * data-model D5). hash/trashpost_id/user_id/username/hidden_at are not in $fillable; the
     * factory runs unguarded so it assigns them without mass-assignment protection.
     *
     * @return array<string, mixed>
     */
    public function definition(): array {
        return [
            'hash' => Str::createUniqueHash(),
            'trashpost_id' => Trashpost::factory(),
            'user_id' => User::factory(),
            'username' => fake()->userName(),
            'body' => fake()->sentence(),
            'hidden_at' => null,
        ];
    }

    /**
     * A hidden comment: excluded from the public list and count, still visible to admins.
     */
    public function hidden(): static {
        return $this->state(fn (array $attributes) => [
            'hidden_at' => now(),
        ]);
    }
}
