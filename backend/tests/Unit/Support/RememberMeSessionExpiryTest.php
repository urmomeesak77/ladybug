<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use Illuminate\Filesystem\Filesystem;
use Illuminate\Session\FileSessionHandler;
use Tests\TestCase;

/**
 * Direct proof of FR-004/SC-002 (Phase 4, US2) of the sliding-window lifetime math every
 * SessionHandlerInterface implementation shares: idle past `$minutes` since the last write
 * reads back empty; activity inside the window restarts it. ApplyRememberMeLifetime (T005)
 * and AuthController::login (T013) only ever change ONE input feeding that math:
 * config('session.lifetime'), which becomes config('remember.lifetime') for a remembered
 * session — fed into the handler's constructor exactly as SessionManager builds it.
 *
 * As of 022 (research D6), production runs `SESSION_DRIVER=database`
 * (`DatabaseSessionHandler`, which compares `last_activity` the same way), not the `file`
 * driver this test exercises directly — chosen for real file mtimes over a real temp
 * directory, with no framework caching to hide behind. This intentionally does NOT drive the
 * proof through simulated HTTP requests against the configured driver (as the rest of this
 * feature's Feature tests do): that Store is cached as a container singleton for the
 * lifetime of a whole test method (Laravel testing quirk, already noted on
 * AuthControllerTest::test_logout_succeeds_for_an_authenticated_user for the closely related
 * logout-revocation case), and Store::loadSession() merges a fresh read onto the OLD
 * in-memory attributes via array_replace() — so a second simulated request's *failed* read
 * is silently masked by data left over from the first.
 *
 * No new production code — Phase 2 (T005) and Phase 3 (T013) already wire
 * config('session.lifetime') to this exact value.
 */
final class RememberMeSessionExpiryTest extends TestCase {
    private string $path;
    private FileSessionHandler $handler;
    private int $lifetimeMinutes;

    protected function setUp(): void {
        parent::setUp();
        $this->lifetimeMinutes = (int) config('remember.lifetime');
        $this->path = sys_get_temp_dir() . '/remember-me-session-expiry-' . uniqid();
        (new Filesystem())->makeDirectory($this->path);
        $this->handler = new FileSessionHandler(new Filesystem(), $this->path, $this->lifetimeMinutes);
    }

    protected function tearDown(): void {
        (new Filesystem())->deleteDirectory($this->path);
        parent::tearDown();
    }

    private function backdateMinutes(int $minutes): void {
        touch($this->path . '/remembered-session', time() - $minutes * 60);
    }

    public function test_a_session_idle_for_a_full_seven_days_is_no_longer_readable(): void {
        $this->handler->write('remembered-session', 'serialized-payload');

        // Still inside the window: unchanged — a sanity check that the file round-trip
        // itself works before proving the expiry boundary.
        $this->backdateMinutes($this->lifetimeMinutes - 60);
        $this->assertSame('serialized-payload', $this->handler->read('remembered-session'));

        // Past config('remember.lifetime') (10080 minutes / 7 days) of idle time: gone —
        // matches today's expired-session behavior, no remember-specific "still half-alive"
        // state (data-model.md §4).
        $this->backdateMinutes($this->lifetimeMinutes + 60);
        $this->assertSame('', $this->handler->read('remembered-session'));
    }

    public function test_activity_before_the_seven_day_mark_restarts_the_window(): void {
        $this->handler->write('remembered-session', 'serialized-payload');

        // Day 5: still well inside the original 7-day window — an ordinary active visit,
        // which StartSession rewrites the file for on every response (research D1), exactly
        // like the write() below.
        $this->backdateMinutes(5 * 24 * 60);
        $this->assertSame('serialized-payload', $this->handler->read('remembered-session'));
        $this->handler->write('remembered-session', 'serialized-payload');

        // Day 8 overall — only 3 days after the day-5 activity, but past what would have
        // been the *original* 7-day-from-login cutoff (day 7). Still valid only because
        // day 5's activity restarted the window (Acceptance Scenario 2 — the sliding
        // restart), proven here by the immediately-preceding write() resetting the mtime.
        $this->backdateMinutes(3 * 24 * 60);
        $this->assertSame('serialized-payload', $this->handler->read('remembered-session'));
    }
}
