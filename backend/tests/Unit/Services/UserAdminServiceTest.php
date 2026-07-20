<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\User;
use App\Services\UserAdminService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The account-list query (US1): every registered account, newest-first by created_at then
 * id, 100 per page, every state included (unverified, disabled, any role). The disabling
 * actor is eager-loaded so the row's disabled_by column costs no extra query per row. An
 * out-of-range page is an empty page, not an error. The disable/enable transitions and the
 * rank guard arrive in US3/US4.
 */
final class UserAdminServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): UserAdminService {
        return new UserAdminService();
    }

    public function test_paginates_at_one_hundred_per_page(): void {
        User::factory()->count(101)->create();

        $page = $this->service()->paginate(1);

        $this->assertSame(100, $page->perPage());
        $this->assertCount(100, $page->items());
        $this->assertSame(101, $page->total());
        $this->assertSame(2, $page->lastPage());
    }

    public function test_orders_newest_first_by_created_at_then_id(): void {
        $older = User::factory()->create(['created_at' => now()->subDay()]);
        $newer = User::factory()->create(['created_at' => now()]);

        $items = $this->service()->paginate(1)->items();

        $this->assertSame($newer->id, $items[0]->id);
        $this->assertSame($older->id, $items[1]->id);
    }

    public function test_breaks_a_created_at_tie_by_id_descending(): void {
        $sameInstant = now();
        $first = User::factory()->create(['created_at' => $sameInstant]);
        $second = User::factory()->create(['created_at' => $sameInstant]);

        $items = $this->service()->paginate(1)->items();

        // Same created_at: the higher id (the later-inserted row) comes first.
        $this->assertSame($second->id, $items[0]->id);
        $this->assertSame($first->id, $items[1]->id);
    }

    public function test_includes_every_account_state(): void {
        $unverified = User::factory()->unverified()->create();
        $admin = User::factory()->admin()->create();
        $superuser = User::factory()->superuser()->create();
        $disabled = User::factory()->disabled()->create();

        $ids = array_map(static fn (User $user): int => $user->id, $this->service()->paginate(1)->items());

        foreach ([$unverified, $admin, $superuser, $disabled] as $expected) {
            $this->assertContains($expected->id, $ids);
        }
    }

    public function test_eager_loads_the_disabling_actor_with_no_n_plus_one(): void {
        $actor = User::factory()->admin()->create();
        User::factory()->count(3)->disabled($actor)->create();

        DB::enableQueryLog();
        $page = $this->service()->paginate(1);
        // Touch the relation on every row: with eager loading this reads from memory,
        // so no query is issued per row.
        foreach ($page->items() as $user) {
            $user->disabledBy?->name;
        }
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        // The page query, its count query, and the single eager-load query for the
        // actors — a per-row lazy load would push this well past a small constant.
        $this->assertLessThanOrEqual(3, count($queries));
    }

    public function test_a_page_beyond_the_last_is_empty_not_an_error(): void {
        User::factory()->count(3)->create();

        $page = $this->service()->paginate(9);

        $this->assertCount(0, $page->items());
        $this->assertSame(3, $page->total());
    }

    public function test_an_empty_corpus_returns_a_zero_total_page(): void {
        $page = $this->service()->paginate(1);

        $this->assertCount(0, $page->items());
        $this->assertSame(0, $page->total());
    }
}
