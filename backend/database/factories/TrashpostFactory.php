<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Trashpost;
use App\Utils\Str;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Trashpost>
 */
class TrashpostFactory extends Factory {
    protected $model = Trashpost::class;

    /**
     * Define the model's default state: a visible image post.
     *
     * @return array<string, mixed>
     */
    public function definition(): array {
        // The on-disk media filename is {code}.{ext}; reuse the canonical hash as
        // the code so image-size lookups (MediaPath) align with the post's hash.
        $code = Str::createUniqueHash();
        $ext = fake()->randomElement(['jpg', 'png', 'gif']);

        return [
            'hash' => $code,
            'type' => 'image',
            'file' => "{$code}.{$ext}",
            'youtube' => null,
            'username' => fake()->userName(),
            // activated_at is not in $fillable; the factory runs unguarded so this
            // is assigned without mass-assignment protection (see the model).
            'activated_at' => now(),
        ];
    }

    /**
     * A post that is publicly visible: activated and not soft-deleted.
     */
    public function visible(): static {
        return $this->state(fn (array $attributes) => [
            'activated_at' => now(),
            'deleted_at' => null,
        ]);
    }

    /**
     * A hidden post: never activated, so excluded from the read-side API.
     */
    public function hidden(): static {
        return $this->state(fn (array $attributes) => [
            'activated_at' => null,
        ]);
    }

    /**
     * A soft-deleted post: present in the table but trashed.
     */
    public function deleted(): static {
        return $this->state(fn (array $attributes) => [
            'deleted_at' => now(),
        ]);
    }

    /**
     * A link-only post (e.g. YouTube): no stored image file.
     */
    public function linkOnly(): static {
        return $this->state(fn (array $attributes) => [
            'type' => 'youtube',
            'file' => null,
            'youtube' => fake()->regexify('[A-Za-z0-9_-]{11}'),
        ]);
    }
}
