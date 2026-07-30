<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\User;
use App\Models\UserIdentity;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<UserIdentity>
 */
class UserIdentityFactory extends Factory {
    protected $model = UserIdentity::class;

    /**
     * A Google link on a fresh account. Nothing here is in $fillable; the factory
     * runs unguarded so it assigns the columns without mass-assignment protection
     * (the same arrangement CommentFactory relies on).
     *
     * The subject is unique because UNIQUE (provider, provider_user_id) is a real
     * constraint (FR-012 direction A) — a repeated draw would fail the insert.
     *
     * @return array<string, mixed>
     */
    public function definition(): array {
        return [
            'user_id' => User::factory(),
            'provider' => 'google',
            // Google's `sub` is currently a 21-digit numeric string.
            'provider_user_id' => (string) fake()->unique()->numerify('#####################'),
        ];
    }
}
