<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\SessionGarbageCollector;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replaces Laravel's own request-triggered session GC (disabled via `session.lottery` in
 * config/session.php — see SessionGarbageCollector's docblock for why it was unsafe here) with
 * a lottery that always sweeps against the fixed, safe `remember.lifetime` floor. Registered as
 * a prepend on both the `api` and `web` groups in `bootstrap/app.php`, mirroring
 * ApplyRememberMeLifetime.
 */
final class CollectStaleSessions {
    /**
     * The liveness probe, which is contractually database-free (routes/api.php,
     * contracts/health.md) so it can answer before any migrations exist. deploy.sh,
     * restore.sh and CI all poll it while MySQL may still be starting; sweeping on it would
     * make the lottery's share of those probes 500 instead of answer, turning a deterministic
     * readiness gate into a probabilistic one.
     */
    private const UNSWEPT_PATHS = ['api/health'];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        if (! $request->is(...self::UNSWEPT_PATHS)) {
            SessionGarbageCollector::sweepIfLucky();
        }

        return $next($request);
    }
}
