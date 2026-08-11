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
 * have (config('remember.lifetime')) as its threshold, so it can never delete a row before that
 * row's own real expiry — whatever that row's actual (shorter or longer) lifetime turns out to
 * be. A non-remembered session past its own short window is already unreadable via the normal
 * per-request expiry check (DatabaseSessionHandler::expired()); sweep() only ever clears rows no
 * policy could still consider alive.
 */
final class SessionGarbageCollector {
    public static function sweep(): int {
        return DB::table(config('session.table'))
            ->where('last_activity', '<=', now()->subMinutes((int) config('remember.lifetime'))->getTimestamp())
            ->delete();
    }

    public static function sweepIfLucky(): void {
        [$chance, $outOf] = config('remember.gc_lottery');
        if (random_int(1, $outOf) <= $chance) {
            self::sweep();
        }
    }
}
