<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Http\Middleware\CollectStaleSessions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Exercises `CollectStaleSessions` in isolation on a throwaway probe route, so its own wiring
 * to `SessionGarbageCollector::sweepIfLucky()` is proven independently of the surrounding
 * `api`/`web` pipeline it is also registered into (`bootstrap/app.php`).
 */
final class CollectStaleSessionsTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();

        Route::middleware([CollectStaleSessions::class])
            ->get('/api/_test/collect-stale-sessions', static fn () => response()->json(['ok' => true]));
    }

    private function insertStaleSession(): void {
        DB::table(config('session.table'))->insert([
            'id' => 'ancient',
            'payload' => base64_encode('irrelevant'),
            'last_activity' => now()->subMinutes((int) config('remember.lifetime') + 60)->getTimestamp(),
        ]);
    }

    public function test_a_lucky_request_sweeps_stale_sessions(): void {
        Config::set('remember.gc_lottery', [100, 100]);
        $this->insertStaleSession();

        $this->getJson('/api/_test/collect-stale-sessions')->assertOk();

        $this->assertFalse(DB::table(config('session.table'))->where('id', 'ancient')->exists());
    }

    public function test_an_unlucky_request_leaves_stale_sessions_alone(): void {
        Config::set('remember.gc_lottery', [0, 100]);
        $this->insertStaleSession();

        $this->getJson('/api/_test/collect-stale-sessions')->assertOk();

        $this->assertTrue(DB::table(config('session.table'))->where('id', 'ancient')->exists());
    }

    /**
     * The tests above prove the MECHANISM on a throwaway route. This one proves the WIRING:
     * that bootstrap/app.php actually prepends the middleware to the real `api` group.
     * Without it, deleting that one line would restore the 7-day remember-me logout bug
     * (018) with a fully green suite.
     */
    public function test_the_sweep_is_wired_into_the_real_api_group(): void {
        Config::set('remember.gc_lottery', [100, 100]);
        $this->insertStaleSession();

        $this->getJson('/api/posts')->assertOk();

        $this->assertFalse(DB::table(config('session.table'))->where('id', 'ancient')->exists());
    }

    /**
     * The liveness probe is contractually database-free so it can answer before migrations
     * have run; deploy.sh, restore.sh and CI all poll it during startup. Sweeping on it would
     * make the lottery's share of those probes 500.
     */
    public function test_the_liveness_probe_never_sweeps(): void {
        Config::set('remember.gc_lottery', [100, 100]);
        $this->insertStaleSession();

        $this->getJson('/api/health')->assertOk();

        $this->assertTrue(DB::table(config('session.table'))->where('id', 'ancient')->exists());
    }

    /**
     * The other half of the same fix: Laravel's own request-triggered GC must stay off. It
     * sweeps against the TRIGGERING request's session.lifetime — the short default on almost
     * every request — and would delete remembered sessions hours into their real allowance.
     * Restoring the framework default here is a one-line change that this pins.
     */
    public function test_laravels_own_unsafe_session_gc_stays_disabled(): void {
        $this->assertSame([0, 100], config('session.lottery'));
    }
}
