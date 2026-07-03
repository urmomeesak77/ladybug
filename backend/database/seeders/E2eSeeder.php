<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\Trashpost;
use Illuminate\Database\Seeder;

/**
 * Feed data for the isolated Playwright e2e stack (docker-compose.e2e.yml), seeded on
 * boot right after migrate:fresh. Exactly TWO feed batches (20 posts): feed.spec asserts
 * the first batch is 10 and the scrolled total is exactly 20 before the end marker, so
 * any other count makes it flaky. The posts are media-less on purpose — no image files
 * exist in the e2e stack's storage, and the specs assert titles/permalinks, not media.
 */
class E2eSeeder extends Seeder {
    private const POST_COUNT = 20;

    public function run(): void {
        // Stagger activation so newest-first ordering (and keyset paging) is deterministic.
        for ($i = 1; $i <= self::POST_COUNT; $i++) {
            Trashpost::factory()->create([
                'title' => sprintf('E2E seed post %02d', $i),
                'activated_at' => now()->subMinutes(self::POST_COUNT - $i),
            ]);
        }
    }
}
