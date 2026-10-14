<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Http\Middleware\ExpireIdleSessions;
use App\Models\User;
use App\Support\RememberMe;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * The remember cookie is a bare presence flag the client controls, so on its own it must not
 * be able to stretch a session its owner never asked to have remembered. The session itself
 * records the choice (RememberMe::SESSION_FLAG, stamped at sign-in), and this middleware
 * enforces the plain idle limit on every session that says "not remembered" — whatever
 * cookie arrives beside it.
 */
final class ExpireIdleSessionsTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();

        Route::middleware([StartSession::class, ExpireIdleSessions::class])
            ->get('/api/_test/expire-idle', static fn (Request $request) => response()->json([
                'user' => $request->user('web')?->id,
                'last_seen' => $request->session()->get(RememberMe::LAST_SEEN),
            ]));
    }

    private function minutesAgo(int $minutes): int {
        return now()->subMinutes($minutes)->getTimestamp();
    }

    public function test_an_unremembered_session_idle_past_the_plain_lifetime_is_ended(): void {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->withSession([RememberMe::SESSION_FLAG => false, RememberMe::LAST_SEEN => $this->minutesAgo(121)])
            ->getJson('/api/_test/expire-idle')
            ->assertOk()
            ->assertJsonPath('user', null);
    }

    public function test_an_unremembered_session_inside_the_plain_lifetime_survives_and_is_restamped(): void {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->withSession([RememberMe::SESSION_FLAG => false, RememberMe::LAST_SEEN => $this->minutesAgo(119)])
            ->getJson('/api/_test/expire-idle');

        $response->assertJsonPath('user', $user->id);
        $this->assertGreaterThanOrEqual($this->minutesAgo(1), $response->json('last_seen'));
    }

    public function test_a_remembered_session_idle_past_the_plain_lifetime_survives(): void {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->withSession([RememberMe::SESSION_FLAG => true, RememberMe::LAST_SEEN => $this->minutesAgo(600)])
            ->getJson('/api/_test/expire-idle')
            ->assertJsonPath('user', $user->id);
    }

    public function test_a_session_from_before_the_flag_existed_is_left_alone(): void {
        // Rolled out against live sessions: one signed in before this release carries no
        // flag, and logging every remembered visitor out on deploy would be the bigger harm.
        // Those rows age out within remember.lifetime on their own.
        $user = User::factory()->create();

        $this->actingAs($user)
            ->withSession([RememberMe::LAST_SEEN => $this->minutesAgo(600)])
            ->getJson('/api/_test/expire-idle')
            ->assertJsonPath('user', $user->id);
    }

    public function test_a_guest_is_not_stamped(): void {
        $this->getJson('/api/_test/expire-idle')
            ->assertJsonPath('user', null)
            ->assertJsonPath('last_seen', null);
    }
}
