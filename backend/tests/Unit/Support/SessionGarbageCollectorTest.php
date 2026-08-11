<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\SessionGarbageCollector;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Root-cause regression coverage for the "remember me silently logs out early" bug: Laravel's
 * own StartSession::collectGarbage() deletes EVERY row in `sessions` older than
 * config('session.lifetime') AT THE TIME OF THE TRIGGERING REQUEST — which, for almost any
 * request on the site other than one carrying this specific user's remember cookie, is the
 * short default (120 minutes), not the 7-day remember.lifetime. That silently destroys a
 * remembered session's row long before its real 7-day allowance is up, while the browser's
 * cookies (whose Max-Age is refreshed unconditionally by ApplyRememberMeLifetime, based only
 * on the remember cookie's presence) still look perfectly valid.
 *
 * SessionGarbageCollector replaces that unsafe, request-relative threshold with a single fixed
 * safe floor (config('remember.lifetime')) that no legitimately-remembered session can ever be
 * younger than its own real expiry and still get swept.
 */
final class SessionGarbageCollectorTest extends TestCase {
    use RefreshDatabase;

    private function insertSession(string $id, int $minutesOld): void {
        DB::table(config('session.table'))->insert([
            'id' => $id,
            'payload' => base64_encode('irrelevant'),
            'last_activity' => now()->subMinutes($minutesOld)->getTimestamp(),
        ]);
    }

    private function sessionExists(string $id): bool {
        return DB::table(config('session.table'))->where('id', $id)->exists();
    }

    public function test_sweep_deletes_a_session_older_than_the_remember_lifetime(): void {
        $lifetime = (int) config('remember.lifetime');
        $this->insertSession('stale', $lifetime + 60);

        SessionGarbageCollector::sweep();

        $this->assertFalse($this->sessionExists('stale'));
    }

    public function test_sweep_never_deletes_a_session_only_past_the_short_default_lifetime(): void {
        // This is the exact shape of the bug: 130 minutes idle is past the default
        // session.lifetime (120), which is what an UNRELATED request's config would have used
        // as Laravel's own GC threshold — but it's nowhere near the 7-day remember window a
        // remembered session is actually entitled to.
        $this->insertSession('still-remembered', 130);

        SessionGarbageCollector::sweep();

        $this->assertTrue($this->sessionExists('still-remembered'));
    }

    public function test_sweep_keeps_a_session_inside_the_remember_lifetime(): void {
        $lifetime = (int) config('remember.lifetime');
        $this->insertSession('fresh', $lifetime - 60);

        SessionGarbageCollector::sweep();

        $this->assertTrue($this->sessionExists('fresh'));
    }

    public function test_sweep_if_lucky_sweeps_when_the_lottery_is_certain(): void {
        Config::set('remember.gc_lottery', [100, 100]);
        $lifetime = (int) config('remember.lifetime');
        $this->insertSession('stale', $lifetime + 60);

        SessionGarbageCollector::sweepIfLucky();

        $this->assertFalse($this->sessionExists('stale'));
    }

    public function test_sweep_if_lucky_does_nothing_when_the_lottery_never_hits(): void {
        Config::set('remember.gc_lottery', [0, 100]);
        $lifetime = (int) config('remember.lifetime');
        $this->insertSession('stale', $lifetime + 60);

        SessionGarbageCollector::sweepIfLucky();

        $this->assertTrue($this->sessionExists('stale'));
    }
}
