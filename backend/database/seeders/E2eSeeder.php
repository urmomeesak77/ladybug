<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\Comment;
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

    /** Comments planted on the newest post so comments.spec can read a populated section. */
    private const SEEDED_COMMENTS = 3;

    public function run(): void {
        $newest = null;
        // Stagger activation so newest-first ordering (and keyset paging) is deterministic.
        for ($i = 1; $i <= self::POST_COUNT; $i++) {
            $newest = Trashpost::factory()->create([
                'title' => sprintf('E2E seed post %02d', $i),
                'activated_at' => now()->subMinutes(self::POST_COUNT - $i),
            ]);
        }

        // The newest post (first in the feed) carries a few comments so the read-side spec
        // can assert a populated, newest-first section; every other post stays comment-free
        // so the same spec can also assert the "no comments yet" empty state.
        for ($n = 1; $n <= self::SEEDED_COMMENTS; $n++) {
            Comment::factory()->for($newest, 'trashpost')->create([
                'body' => sprintf('E2E seed comment %02d', $n),
                'created_at' => now()->subMinutes(self::SEEDED_COMMENTS - $n),
            ]);
        }
    }
}
