<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Models\User;
use App\Services\UserAdminService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * The account-list query (US1): every registered account, newest-first by created_at then
 * id, 100 per page, every state included (unverified, disabled, any role). The disabling
 * actor is eager-loaded so the row's disabled_by column costs no extra query per row. An
 * out-of-range page is an empty page, not an error.
 *
 * US3 adds the disable/enable transitions: both are set-to-target (not toggle), so a repeat
 * is a no-op that preserves the original timestamp/actor, and they write ONLY the two
 * disabled_* columns — never role, e-mail, rating, or any owned meme (access revocation only,
 * research D9). The strict-rank guard arrives in US4.
 */
final class UserAdminServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): UserAdminService {
        return new UserAdminService();
    }

    public function test_disable_sets_disabled_at_and_disabled_by_together(): void {
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create();

        $result = $this->service()->disable($actor, $target->hash);

        $this->assertTrue($result->isDisabled());
        $this->assertNotNull($result->disabled_at);
        $this->assertSame($actor->id, $result->disabled_by);
        $target->refresh();
        $this->assertNotNull($target->disabled_at);
        $this->assertSame($actor->id, $target->disabled_by);
    }

    public function test_enable_clears_disabled_at_and_disabled_by_together(): void {
        $actor = User::factory()->admin()->create();
        $target = User::factory()->disabled($actor)->create();

        $result = $this->service()->enable($actor, $target->hash);

        $this->assertFalse($result->isDisabled());
        $this->assertNull($result->disabled_at);
        $this->assertNull($result->disabled_by);
        $target->refresh();
        $this->assertNull($target->disabled_at);
        $this->assertNull($target->disabled_by);
    }

    public function test_disabling_an_already_disabled_account_keeps_the_original_timestamp_and_actor(): void {
        $firstActor = User::factory()->admin()->create();
        $target = User::factory()->disabled($firstActor)->create(['disabled_at' => '2026-01-01 00:00:00']);
        $secondActor = User::factory()->admin()->create();

        $result = $this->service()->disable($secondActor, $target->hash);

        // Set-to-target, not toggle: a repeat disable neither churns the timestamp nor
        // reassigns the actor to whoever clicked second.
        $this->assertSame('2026-01-01 00:00:00', $result->disabled_at?->format('Y-m-d H:i:s'));
        $this->assertSame($firstActor->id, $result->disabled_by);
    }

    public function test_enabling_an_active_account_is_a_no_op(): void {
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create();

        $result = $this->service()->enable($actor, $target->hash);

        $this->assertFalse($result->isDisabled());
        $this->assertNull($result->disabled_at);
        $this->assertNull($result->disabled_by);
    }

    public function test_disable_changes_nothing_but_the_disabled_columns(): void {
        // FR-010/FR-010a, research D9: disabling is access revocation only — it must not
        // touch role, credentials, rating, or the account's memes.
        $actor = User::factory()->admin()->create();
        $target = User::factory()->create(['rating' => 7]);
        $post = Trashpost::factory()->create(['user_id' => $target->id]);
        $before = [
            'role' => $target->role->value,
            'email' => $target->email,
            'email_verified_at' => $target->email_verified_at,
            'password' => $target->password,
            'rating' => $target->rating,
        ];

        $this->service()->disable($actor, $target->hash);

        $target->refresh();
        $this->assertSame($before['role'], $target->role->value);
        $this->assertSame($before['email'], $target->email);
        $this->assertEquals($before['email_verified_at'], $target->email_verified_at);
        $this->assertSame($before['password'], $target->password);
        $this->assertSame($before['rating'], $target->rating);
        // The owned meme keeps its activation and visibility — takedown stays moderation's job.
        $post->refresh();
        $this->assertNotNull($post->activated_at);
        $this->assertNull($post->deleted_at);
    }

    public function test_admin_cannot_disable_a_peer_admin(): void {
        $admin = User::factory()->admin()->create();
        $peer = User::factory()->admin()->create();

        $this->assertRefused(fn () => $this->service()->disable($admin, $peer->hash), $peer);
    }

    public function test_admin_cannot_disable_a_superuser(): void {
        $admin = User::factory()->admin()->create();
        $superuser = User::factory()->superuser()->create();

        $this->assertRefused(fn () => $this->service()->disable($admin, $superuser->hash), $superuser);
    }

    public function test_admin_cannot_disable_itself(): void {
        // A role never outranks itself, so the peer guard is also the self-lockout guard —
        // no separate id-comparison branch is needed (research D5).
        $admin = User::factory()->admin()->create();

        $this->assertRefused(fn () => $this->service()->disable($admin, $admin->hash), $admin);
    }

    public function test_superuser_cannot_disable_a_peer_superuser(): void {
        $superuser = User::factory()->superuser()->create();
        $peer = User::factory()->superuser()->create();

        $this->assertRefused(fn () => $this->service()->disable($superuser, $peer->hash), $peer);
    }

    public function test_admin_can_disable_a_member(): void {
        $admin = User::factory()->admin()->create();
        $member = User::factory()->create();

        $this->assertTrue($this->service()->disable($admin, $member->hash)->isDisabled());
    }

    public function test_superuser_can_disable_an_admin(): void {
        $superuser = User::factory()->superuser()->create();
        $admin = User::factory()->admin()->create();

        $this->assertTrue($this->service()->disable($superuser, $admin->hash)->isDisabled());
    }

    public function test_the_guard_reads_the_current_stored_role_not_the_stale_rendered_one(): void {
        // FR-012: the target's role was raised above the actor's after the page was rendered.
        // The guard runs against freshly loaded rows inside the transaction, so the action is
        // refused on the CURRENT stored role — the stale client view buys nothing.
        $admin = User::factory()->admin()->create();
        $nowSuperuser = User::factory()->superuser()->create();

        $this->assertRefused(fn () => $this->service()->disable($admin, $nowSuperuser->hash), $nowSuperuser);
    }

    public function test_the_sole_superuser_cannot_be_disabled_by_anyone(): void {
        // Nobody outranks the only superuser, so the US4 rule already protects it with no
        // special "last superuser" case — an admin is refused, and no peer exists to try.
        $superuser = User::factory()->superuser()->create();
        $admin = User::factory()->admin()->create();

        $this->assertRefused(fn () => $this->service()->disable($admin, $superuser->hash), $superuser);
    }

    /**
     * A refused transition throws a 403 and leaves the target untouched (still active).
     */
    private function assertRefused(callable $action, User $target): void {
        try {
            $action();
            $this->fail('Expected the transition to be refused with a 403.');
        }
        catch (HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
        $target->refresh();
        $this->assertFalse($target->isDisabled());
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
