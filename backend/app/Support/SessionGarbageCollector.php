<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Replaces Laravel's built-in session GC (`StartSession::collectGarbage()`, disabled via
 * `config('session.lottery') = [0, 100]`) for one reason: that built-in sweep deletes every row
 * in `sessions` older than config('session.lifetime') AS SEEN BY THE TRIGGERING REQUEST. Almost
 * every request on the site does not carry a given user's remember-me cookie, so its
 * session.lifetime is the short default — which would delete a "remembered" session's row
 * hours into its real 7-day allowance (018-remember-me-login), while ApplyRememberMeLifetime
 * keeps refreshing that user's cookies regardless, since it only checks the cookie's presence.
 *
 * sweep() always uses the single longest lifetime any session on this site can legitimately
 * have (floorMinutes() below) as its threshold, so it can never delete a row before that
 * row's own real expiry — whatever that row's actual (shorter or longer) lifetime turns out to
 * be. A non-remembered session past its own short window is already unreadable via the normal
 * per-request expiry check (DatabaseSessionHandler::expired()); sweep() only ever clears rows no
 * policy could still consider alive.
 */
final class SessionGarbageCollector {
    /** config('remember.gc_lottery')'s shipped odds, used when that key is missing or malformed. */
    private const DEFAULT_LOTTERY = [2, 100];

    public static function sweep(): int {
        return DB::table(config('session.table'))
            ->where('last_activity', '<=', now()->subMinutes(self::floorMinutes())->getTimestamp())
            ->delete();
    }

    public static function sweepIfLucky(): void {
        [$chance, $outOf] = self::lottery();
        if (random_int(1, $outOf) <= $chance) {
            self::sweep();
        }
    }

    /**
     * The longest lifetime any session here can legitimately have.
     *
     * Nothing enforces SESSION_LIFETIME <= REMEMBER_ME_LIFETIME, so taking remember.lifetime
     * alone would make this class's central claim false the moment an operator raised the
     * plain lifetime above the remembered one — and sweep() would delete live sessions. The
     * max makes the claim true by construction. This middleware runs before
     * ApplyRememberMeLifetime, so session.lifetime here is always the base value.
     */
    private static function floorMinutes(): int {
        return max((int) config('session.lifetime'), (int) config('remember.lifetime'), 1);
    }

    /**
     * The odds, defaulted rather than destructured blind: this runs from middleware prepended
     * to every group, so a missing or malformed key would otherwise reach random_int(1, 0) and
     * throw a ValueError — a hard 500 on every request on the site, from a config typo.
     *
     * @return array{int, int}
     */
    private static function lottery(): array {
        $lottery = config('remember.gc_lottery');
        if (! is_array($lottery) || count($lottery) !== 2) {
            $lottery = self::DEFAULT_LOTTERY;
        }

        return [(int) $lottery[0], max(1, (int) $lottery[1])];
    }
}
