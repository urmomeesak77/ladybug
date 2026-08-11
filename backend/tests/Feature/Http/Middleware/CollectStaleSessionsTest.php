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
}
