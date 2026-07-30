<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory {
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array {
        return [
            'name' => fake()->name(),
            // 10-char public account identifier; the column is unique and
            // non-null, so the factory mints one (assigned, not mass-assigned).
            'hash' => Str::random(10),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
            // Every account carries exactly one role; new accounts default to
            // member (FR-004). admin()/superuser() states override for tests.
            'role' => Role::Member->value,
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    /**
     * Indicate that the account was created through Google and has no password at
     * all: verified because Google confirmed the address (FR-014), member role like
     * any other new account (FR-013). The fixture for every FR-020 assertion.
     */
    public function googleOnly(): static {
        return $this->state(fn (array $attributes) => [
            'password' => null,
            'email_verified_at' => now(),
            'role' => Role::Member->value,
        ]);
    }

    /**
     * Indicate that the account holds the admin role.
     */
    public function admin(): static {
        return $this->state(fn (array $attributes) => [
            'role' => Role::Admin->value,
        ]);
    }

    /**
     * Indicate that the account holds the superuser role.
     */
    public function superuser(): static {
        return $this->state(fn (array $attributes) => [
            'role' => Role::Superuser->value,
        ]);
    }

    /**
     * Indicate that the account's access is revoked. The acting moderator is
     * optional so tests can build the "actor unresolvable" row (INV-3) directly.
     */
    public function disabled(?User $actor = null): static {
        return $this->state(fn (array $attributes) => [
            'disabled_at' => now(),
            'disabled_by' => $actor?->id,
        ]);
    }
}
